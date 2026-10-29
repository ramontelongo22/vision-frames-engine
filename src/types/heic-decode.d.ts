/** Minimal typings for heic-decode 2.x (the package ships none). */
declare module 'heic-decode' {
  interface DecodedHeicImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel */
    data: Uint8ClampedArray;
  }

  interface PendingHeicImage {
    width: number;
    height: number;
    decode(): Promise<DecodedHeicImage>;
  }

  type PendingHeicImages = PendingHeicImage[] & { dispose(): void };

  function decode(input: { buffer: Uint8Array }): Promise<DecodedHeicImage>;
  namespace decode {
    function all(input: { buffer: Uint8Array }): Promise<PendingHeicImages>;
  }

  export = decode;
}
