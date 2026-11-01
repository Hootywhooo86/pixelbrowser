// Extends app.json. BIT_PLAY_BUILD=1 makes the Google Play build, which leaves
// out YouTube ad blocking (Play policy). Everything else lives in app.json.
module.exports = ({ config }) => ({
  ...config,
  extra: { ...(config.extra || {}), playBuild: process.env.BIT_PLAY_BUILD === '1' },
})
