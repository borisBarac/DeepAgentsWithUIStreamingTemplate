import type { Preview } from "@storybook/react";

import "../app/globals.css";

/**
 * Project-level preview for the web-app Storybook.
 *
 * Imports `globals.css` so every story sees the same `.app-shell`, `.message`,
 * `.product-card`, `.jr-button`, etc. classes the Next.js app uses in
 * production. Stories render against the real stylesheet — no Storybook-only
 * CSS overrides.
 */
const preview: Preview = {
  parameters: {
    controls: { sort: "requiredFirst" },
    layout: "fullscreen",
    docs: {
      toc: { headingSelector: "h2, h3" },
    },
    a11y: {
      element: "#storybook-root",
      manual: false,
    },
  },
  tags: ["autodocs"],
};

export default preview;
