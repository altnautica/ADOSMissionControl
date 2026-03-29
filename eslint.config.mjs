import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextCoreWebVitals,
  {
    ignores: [
      "convex/_generated/**",
      "convex-tutorial/**",
    ],
  },
];
