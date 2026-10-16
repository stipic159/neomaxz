declare module 'lz4js' {
  export function decompressBlock(
    src: Uint8Array | Buffer,
    dst: Uint8Array | Buffer,
    sIdx: number,
    sLen: number,
    dIdx: number
  ): number;
}
