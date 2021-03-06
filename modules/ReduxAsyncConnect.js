import PropTypes from 'prop-types';
import React from 'react';
import { beginGlobalLoad, endGlobalLoad, fullEndGlobalLoad } from './asyncConnect';
import { ReactReduxContext } from 'react-redux';

const { array, func, object, any, bool } = PropTypes;

function filterAndFlattenComponents(components) {
  const flattened = [];
  components.forEach((Component) => {
    if (Component && Component.reduxAsyncConnect) {
      flattened.push(Component);
    }
  });
  return flattened;
}

function loadAsyncConnect({components, filter = () => true, skip = () => false, ...rest}) {
  let async = false;
  let incomplete = false;

  const filteredKeys = [];
  const filteredPromises = [];
  const allPromises = [];

  filterAndFlattenComponents(components).forEach(Component => {
    Component.reduxAsyncConnect.forEach(item => {
      if (skip(item)) {
        incomplete = true;
        return;
      }

      const promiseOrResult = item.promise(rest);
      let itemPromise = promiseOrResult instanceof Promise ?
          promiseOrResult :
          Promise.resolve(promiseOrResult);

      itemPromise = itemPromise.catch(error => ({error}));
      allPromises.push(itemPromise);
      if (filter(item, Component)) {
        async = true;
        filteredKeys.push(item.key);
        filteredPromises.push(itemPromise);
      }
    });
  });

  const allPromise = Promise.all(allPromises);
  const promise = Promise.all(filteredPromises).then(results => {
    return filteredKeys.reduce((result, key, i) => {
      if (key) {
        result[key] = results[i];
      }
      return result;
    }, {});
  });

  return {allPromise, promise, async, incomplete};
}

export function loadOnServer(args) {
  const result = loadAsyncConnect(args);
  if (result.async && !result.incomplete) {
    return result.promise.then(data => {
      args.store.dispatch(endGlobalLoad());
      args.store.dispatch(fullEndGlobalLoad());
      return data;
    });
  }
  return result.promise;
}

let loadDataCounter = 0;

export default class ReduxAsyncConnect extends React.Component {
  static propTypes = {
    components: array.isRequired,
    params: object.isRequired,
    render: func.isRequired,
    renderIfNotLoaded: bool,
    helpers: any
  };

  static contextType = ReactReduxContext;

  isLoaded() {
    return this.context.store.getState().reduxAsyncConnect.loaded;
  }

  constructor(props, context) {
    super(props, context);

    this.state = {
      propsToShow: props.renderIfNotLoaded || this.isLoaded() ? props : null
    };
  }

  componentDidMount() {
    const dataLoaded = this.isLoaded();

    if (!dataLoaded) { // we dont need it if we already made it on server-side
      this.loadAsyncData(this.props);
    }
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    this.loadAsyncData(nextProps);
  }

  shouldComponentUpdate(nextProps, nextState) {
    return this.state.propsToShow !== nextState.propsToShow;
  }

  loadAsyncData(props) {
    const store = this.context.store;
    const loadResult = loadAsyncConnect({...props, store});

    loadDataCounter++;

    store.dispatch(beginGlobalLoad());
    return (loadDataCounterOriginal => {
      loadResult.promise.then(() => {
        // We need to change propsToShow only if loadAsyncData that called this promise
        // is the last invocation of loadAsyncData method. Otherwise we can face situation
        // when user is changing route several times and we finally show him route that has
        // loaded props last time and not the last called route
        if (loadDataCounter === loadDataCounterOriginal) {
          this.setState({propsToShow: props});
          store.dispatch(endGlobalLoad());
        }
      });
      return loadResult.allPromise.then(() => {
        if (loadDataCounter === loadDataCounterOriginal) {
          store.dispatch(fullEndGlobalLoad());
        }
      })
    })(loadDataCounter);
  }

  render() {
    const {propsToShow} = this.state;
    return propsToShow && this.props.render(propsToShow);
  }
}
