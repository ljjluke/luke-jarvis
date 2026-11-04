/** core 公共出口：领域模型、端口、内存仓储、任务单生命周期、阶段判定、引擎。
 *  移植自 dsh-superagent-prototype 的 core 分层；宿主适配（JSON 仓储 / DSH 执行器）在 host/ 下单独提供。 */
export * from './model.js'
export * from './reasons.js'
export * from './stage.js'
export * from './tickets.js'
export * from './engine.js'
export * from './ports.js'
export * from './memory.js'
