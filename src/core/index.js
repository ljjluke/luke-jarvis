/** 核心层统一出口（对应 superagent 的 src/core/index.ts）。 */
export { createEngine } from './engine.js'
export { Effects, Later } from './effects.js'
export { UserError, USER_ERRORS } from './errors.js'
export { applyCompanyActionTo, companyEvent, emptyCompanyState, waitingForPerson, settled } from './model.js'
