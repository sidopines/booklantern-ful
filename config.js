// config.js
// Feature flags for connectors in production

module.exports = {
  // Connector feature flags - set to "true" to enable in production
  CONNECTOR_FEEDBOOKS: process.env.CONNECTOR_FEEDBOOKS === "true",
  CONNECTOR_HATHI: process.env.CONNECTOR_HATHI === "true", 
  CONNECTOR_FREEWEB: process.env.CONNECTOR_FREEWEB === "true",
  
  // Cinematic features
  CINEMATIC: process.env.CINEMATIC === "on",
  GUTEN_ENABLED: process.env.GUTEN_ENABLED === "on",
  
  // Environment detection
  IS_PRODUCTION: process.env.NODE_ENV === "production"
};
