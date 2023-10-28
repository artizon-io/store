import { SetStateError, Store, createObjectStore } from ".";

/**
 * Extract type of a `Store` by retrieving return type of `getState`
 */
type GetStoreState<T> = T extends Store<any>
  ? ReturnType<T["getState"]>
  : never;

/**
 * Extract the types of an array of `Store`s
 */
type UnwrapStores<T> = T extends readonly Store<any>[]
  ? T extends [infer Head, ...infer Tail]
    ? readonly [GetStoreState<Head>, ...UnwrapStores<Tail>]
    : readonly []
  : never;

/**
 * A store that derives its state from other zustand stores. An internal `ObjectStore` is used to facilitate this custom store implementation.
 * @param stores The input stores
 * @param onChange A function thast takes the state of the input stores and returns the derived state.
 * `onChanged` is called whenever any of the input stores change, and when the derived store is first created.
 *
 * @returns A `Store`. Typescript can infer if the derived store is a `SimpleStore` or an `ObjectStore`. But it can always be asserted with `as`.
 */
export const derive = <
  T extends any,
  Stores extends readonly Store<any>[],
  DepsState extends UnwrapStores<Stores> = UnwrapStores<Stores>
>(
  stores: Stores,
  onChange: (
    depsState: DepsState,
    prevDepsState: DepsState | null,
    prevState: T | null
  ) => T
): Store<T> => {
  type Listener = (state: T, prevState: T) => void;

  /**
   * The initial states of the input stores
   */
  // @ts-ignore
  const initialDepsState = stores.map((store) => store.getState()) as DepsState;

  const store = createObjectStore<{
    /**
     * Set of listeners of the derived store
     */
    listeners: Set<Listener>;
    /**
     * The states of the input stores
     */
    depsState: DepsState;
    /**
     * The previous states of the input stores, as a whole, not individually.
     * i.e. The previous state of the states of the input stores.
     */
    prevDepsState: DepsState | null;
    /**
     * The derived state
     */
    state: T;
    /**
     * The previous derived state
     */
    prevState: T | null;
    /**
     * The unsubscribe handlers of the input stores
     */
    depsSubs: (() => void)[];
  }>((set, get) => ({
    listeners: new Set(),
    depsState: initialDepsState,
    prevDepsState: null,
    state: onChange(initialDepsState, null, null),
    prevState: null,
    depsSubs: [],
  }));

  const depsSubs = stores.map((depStore, index) =>
    depStore.subscribe((depState, prevDepState) => {
      const currentDepsState = store.getState().depsState;

      // Immer's pitfall with circular trees
      // https://immerjs.github.io/immer/pitfalls/#immer-only-supports-unidirectional-trees

      const newDepsState: DepsState = [...currentDepsState];
      // @ts-ignore
      newDepsState[index] = depState;

      const prevState = store.getState().state;

      const newState = onChange(newDepsState, currentDepsState, prevState);

      store.setState({
        prevDepsState: currentDepsState,
        depsState: newDepsState,
        prevState: prevState,
        state: newState,
      });

      store.getState().listeners.forEach((listener) =>
        listener(
          newState,
          prevState ?? newState // `Listener` restructs `prevState` to be non-null
        )
      );
    })
  );

  store.setState({ depsSubs });

  return {
    getState: () => store.getState().state,
    subscribe: (listener: Listener) => {
      const newListeners = new Set([...store.getState().listeners, listener]);

      store.setState({
        listeners: newListeners,
      });

      return () => {
        const listeners = store.getState().listeners;
        listeners.delete(listener);
        store.setState({
          listeners: listeners,
        });
      };
    },
    setState: () => {
      throw new SetStateError("`setState` is not available in derived store");
    },
  };
};
