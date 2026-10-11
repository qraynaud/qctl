// Bun text imports (`import x from "./file.schema" with { type: "text" }`).
declare module "*.schema" {
  const content: string;
  export default content;
}
