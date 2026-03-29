declare module 'tinyop' {
  export type Schema = Record<string, Record<string, any>>;

  export interface StoreConfig {
    idGenerator?: () => string;
    types?: Set<string>;
    defaults?: Record<string, any>;
    spatialGridSize?: number;
    maxQueryCache?: number;
  }

  export type Predicate<T> = (item: T) => boolean;

  export interface QueryResult<T> {
    all(): T[];
    first(): T | null;
    last(): T | null;
    count(): number;
    ids(): string[];
    limit(n: number): QueryResult<T>;
    offset(n: number): QueryResult<T>;
    sort<K extends keyof T>(field: K): QueryResult<T>;
  }

  export interface View<T> {
    (): T[];
    all(): T[];
    first(): T | null;
    last(): T | null;
    count(): number;
    ids(): string[];
    destroy(): void;
  }

  export interface SpatialView<T> extends View<T> {
    recenter(x: number, y: number): void;
  }

  export type ViewOptions =
    | { spatial?: false }
    | { spatial: true; x: number; y: number; r: number; threshold?: number };

  export interface Where {
    eq<T, K extends keyof T>(k: K, v: T[K]): Predicate<T>;
    ne<T, K extends keyof T>(k: K, v: T[K]): Predicate<T>;
    gt<T, K extends keyof T>(k: K, v: T[K]): Predicate<T>;
    gte<T, K extends keyof T>(k: K, v: T[K]): Predicate<T>;
    lt<T, K extends keyof T>(k: K, v: T[K]): Predicate<T>;
    lte<T, K extends keyof T>(k: K, v: T[K]): Predicate<T>;
    in<T, K extends keyof T>(k: K, values: T[K][]): Predicate<T>;
    contains<T, K extends keyof T>(k: K, v: string): Predicate<T>;
    startsWith<T, K extends keyof T>(k: K, v: string): Predicate<T>;
    endsWith<T, K extends keyof T>(k: K, v: string): Predicate<T>;
    exists<T, K extends keyof T>(k: K): Predicate<T>;
    and<T>(...fs: Predicate<T>[]): Predicate<T>;
    or<T>(...fs: Predicate<T>[]): Predicate<T>;
  }

  export const where: Where;

  export interface CreateEvent<T> { id: string; item: T; old: null; }
  export interface UpdateEvent<T> { id: string; item: T; old: T; }
  export interface DeleteEvent<T> { id: string; item: T; }
  export interface BatchEvent { op: 'create' | 'update' | 'delete'; count: number; }

  export interface ChangeEvent<T> {
    type: 'create' | 'update' | 'delete' | 'batch';
    id?: string;
    item?: T;
    op?: BatchEvent['op'];
    count?: number;
  }

  export type EventMap<T> = {
    create: CreateEvent<T>;
    update: UpdateEvent<T>;
    delete: DeleteEvent<T>;
    change: ChangeEvent<T>;
    batch: BatchEvent;
  };

  export interface TinyOpStore<S extends Schema = Schema> {
    create<K extends keyof S>(type: K, data?: Partial<S[K]>): S[K];
    createMany<K extends keyof S>(type: K, arr: Partial<S[K]>[]): S[K][];

    get<K extends keyof S>(id: string): S[K] | null;
    getRef<K extends keyof S>(id: string): S[K] | null;

    pick<K extends keyof S, F extends keyof S[K]>(
      id: string,
      fields: F[]
    ): Pick<S[K], F> | null;

    exists(id: string): boolean;

    find<K extends keyof S>(type: K, pred?: Predicate<S[K]>): QueryResult<S[K]>;
    near<K extends keyof S>(
      type: K,
      x: number,
      y: number,
      r: number,
      pred?: Predicate<S[K]>
    ): QueryResult<S[K]>;

    count<K extends keyof S>(type: K, pred?: Predicate<S[K]>): number;

    update<K extends keyof S>(
      id: string,
      changes: Partial<S[K]> | ((item: S[K]) => Partial<S[K]>)
    ): S[K] | null;

    set<K extends keyof S, F extends keyof S[K]>(
      id: string,
      field: F,
      value: S[K][F]
    ): S[K] | null;

    increment<K extends keyof S, F extends keyof S[K]>(
      id: string,
      field: F,
      by?: number
    ): S[K] | null;

    delete(id: string): S[keyof S] | null;
    deleteMany(ids: string[]): S[keyof S][];

    batch: {
      create<K extends keyof S>(type: K, arr: Partial<S[K]>[]): S[K][];
      update(
        updates: Array<{ id: string; changes: Partial<S[keyof S]> }>
      ): S[keyof S][];
      delete(ids: string[]): S[keyof S][];
    };

    transaction<T>(fn: () => T): T;

    view<K extends keyof S>(
      type: K,
      pred?: Predicate<S[K]>,
      opts?: ViewOptions
    ): View<S[K]> | SpatialView<S[K]>;

    on<E extends keyof EventMap<S[keyof S]>>(
      event: E,
      cb: (data: EventMap<S[keyof S]>[E]) => void
    ): () => void;

    once<E extends keyof EventMap<S[keyof S]>>(
      event: E,
      cb: (data: EventMap<S[keyof S]>[E]) => void
    ): () => void;

    off<E extends keyof EventMap<S[keyof S]>>(
      event: E,
      cb: (data: EventMap<S[keyof S]>[E]) => void
    ): void;

    clear(): number;

    dump(): Record<string, S[keyof S]>;

    stats(): {
      items: number;
      types: Record<string, number>;
      spatial: { cells: number; coords: number };
      listeners: Record<string, number>;
    };

    meta: {
      get(k: string): any;
      set(k: string, v: any): void;
      config(): StoreConfig;
    };
  }

  export function createStore<S extends Schema = Schema>(
    config?: StoreConfig
  ): TinyOpStore<S>;

  export default createStore;
}
