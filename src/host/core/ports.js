/** 端口：core 只依赖这些接口，不依赖 DSH / 文件系统 / 执行器实现（移植自 prototype `core/ports.ts`）。
 *  实现方（适配层）负责真存储与真执行；core 通过端口拿能力，测试用内存实现。 */

/**
 * @typedef {object} Repositories 持久化端口（全部同步，`atomic` 包住一个工作单元；异步由适配层在外层处理）
 * @property {<T>(work:()=>T)=>T} atomic 原子事务（失败回滚）
 * @property {{get:(id:string)=>any, save:(t:any)=>void, list:()=>any[], open:()=>any[], active:()=>any[]}} tickets
 * @property {{get:(id:string)=>any, save:(t:any)=>void, list:()=>any[]}} decisions
 */

/**
 * @typedef {object} Executor 执行器端口：core 只排队，不直接跑会话
 * @property {(ticket:any, assignment:any)=>void} start 排队启动一个派单（执行器事后回调 engine.report/started）
 * @property {(ticket:any, assignment:any, reason:string)=>void} [stop] 结束一个派单（取消会话/任务）
 */

/**
 * @typedef {object} Clock 时钟端口
 * @property {()=>string} now 返回 ISO 时间
 */

/**
 * @typedef {object} Policy 闸/授权端口：决定某个任务单在本阶段是否被授权
 * @property {(input:{ticket:any, stage:string, action:string})=>({ok:true, basis?:string}|{ok:false, reason:string})} gate
 * @property {(mandate:any)=>{ok:boolean, reason?:string}} [revalidate] 已结束任务单恢复前复验授权
 */

/**
 * @typedef {object} Outbox 出站端口：通知/回复先入队，由外部投递（移植自 prototype 的 Outbox）
 * @property {(message:{id:string, kind:string, text:string, ticketId?:string})=>void} send 幂等入队
 * @property {(id:string)=>('pending'|'sent'|'dropped'|undefined)} status
 * @property {(id:string)=>void} [withdraw]
 */

export const noopExecutor = {
  start() {},
  stop() {},
}

export const systemClock = {
  now: () => new Date().toISOString(),
}

/** 默认策略：不设闸（授权由调用方显式给；需要阶段闸的适配层传自己的 Policy）。 */
export const allowAllPolicy = {
  gate: () => ({ ok: true, basis: 'policy:allow-all' }),
  revalidate: () => ({ ok: true }),
}
