declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  type HeifImage = {
    get_width(): number;
    get_height(): number;
    is_primary?(): boolean;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      done: (result: unknown) => void,
    ): void;
    free?(): void;
  };
  const factory: () => { HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] } };
  export default factory;
}
