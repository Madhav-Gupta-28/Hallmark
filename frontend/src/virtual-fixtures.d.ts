/** Served by the `hallmark-fixtures` plugin in vite.config.ts, built by ../fixtures.ts. */
declare module "virtual:hallmark-fixtures" {
  const fixtures: Record<"honest" | "worst" | "sandbox", import("./lib/hallmark").Fixture>;
  export default fixtures;
}
