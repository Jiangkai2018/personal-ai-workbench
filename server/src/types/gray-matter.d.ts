declare module 'gray-matter' {
  interface GrayMatterOption {
    engines?: Record<string, unknown>
    excerpt?: boolean | ((file: unknown) => unknown)
  }
  interface GrayMatterFile<I extends string = string> {
    data: Record<string, unknown>
    content: string
    excerpt?: string
    orig: Buffer | I
    language: string
    matter: string
    stringify(lang?: string): string
    isEmpty: boolean
  }
  function matter(input: string | Buffer, options?: GrayMatterOption): GrayMatterFile
  function matter(input: string | Buffer, options?: GrayMatterOption): GrayMatterFile
  function matter(input: string | Buffer, options?: GrayMatterOption): GrayMatterFile
  namespace matter {
    function stringify(
      input: string,
      data?: Record<string, unknown>,
      options?: GrayMatterOption,
    ): string
  }
  export = matter
}
