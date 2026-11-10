/**
 * near-api-js is large and only needed once a session key signs, so it loads on demand and stays out
 * of the first-load bundle. Every importer goes through here to keep one lazy boundary.
 */
export const loadNear = () => import('near-api-js');
export const loadRpcErrors = () => import('near-api-js/rpc-errors');
