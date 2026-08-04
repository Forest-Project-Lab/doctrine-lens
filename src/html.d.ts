// doctrine:begin IMPL-001
// esbuild の text loader で内蔵する HTML(System Map 実験画面)。
declare module "*.html" {
  const content: string;
  export default content;
}
// doctrine:end IMPL-001
