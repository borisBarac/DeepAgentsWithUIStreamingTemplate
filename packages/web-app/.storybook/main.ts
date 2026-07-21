import type { StorybookConfig } from "@storybook/nextjs";

/**
 * Single consolidated Storybook for the whole workspace.
 *
 * Two sections, surfaced as top-level groups in the sidebar by directory:
 *  - `Web App/…`  — Next.js app components (stories live beside source).
 *  - `Core Catalog/…` — every component declared in
 *    `packages/core/catalog/catalog.json`, exercised through the real
 *    `<Renderer>` from `packages/web-app/src/ui/catalog.tsx`.
 */
const config: StorybookConfig = {
  stories: [
    "../app/**/*.stories.@(ts|tsx|mdx)",
    "../src/**/*.stories.@(ts|tsx|mdx)",
    "../../core/catalog/stories/**/*.stories.@(ts|tsx|mdx)",
  ],
  addons: ["@storybook/addon-onboarding", "@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
  docs: {
    autodocs: true,
  },
};

export default config;
