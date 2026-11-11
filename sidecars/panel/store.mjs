import { createHash } from 'node:crypto';
import { AntigravityClient } from './client.mjs';
import { quotaMetrics, trajectoryMetrics } from './metrics.mjs';
import { SessionHistory, usableMetrics, reconcileMetrics } from './history.mjs';
import { TranscriptReader } from './transcript.mjs';
import {DelegatedUsage} from './delegated-usage.mjs';
import {delegatedIds} from './delegation.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class MetricsStore {
  constructor(client = new AntigravityClient(), { history = new SessionHistory(), onTrajectory = null, transcripts = new TranscriptReader(), owns=()=>true } = {}) {
    this.client = client; this.history = history; this.onTrajectory=onTrajectory; this.transcripts=transcripts; this.owns=owns;
    this.delegated=new DelegatedUsage(client,{owns,
      onSource:async(scope,id,raw)=>{if(this.owned()&&scope===this.identity&&this.onTrajectory)await this.onTrajectory(scope,id,raw);},
      onUpdate:async(scope,id,taskUsage,delegatedConversations)=>{
        const entry=this.sessions.get(id);if(!this.owned()||scope!==this.identity||!entry?.data)return;
        const epoch=this.epoch,current=()=>this.owned()&&scope===this.identity&&epoch===this.epoch&&this.sessions.get(id)===entry;
        entry.data={...entry.data,taskUsage,delegatedConversations};
        try{const saved=await this.history.save(scope,id,entry.data,{isCurrent:current});if(saved&&current())entry.savedAt=saved.savedAt;}
        catch{if(current())this.persistenceError='统计暂时无法保存到本地';}
      },
    });
  }
  quota = null;
  quotaAt = 0;
  quotaPending = null;
  identity = null;
  serverPid = null;
  summaries = [];
  summariesAt = 0;
  sessions = new Map();
  persistenceError = null;
  epoch = 0;
  disposed = false;
  // Collection callbacks need a synchronous boolean. A Promise must never grant
  // ownership, and this hot predicate must not start disk I/O.
  owned(){return !this.disposed&&this.owns()===true;}

  async cachedSession(id) {
    if (!this.owned() || !GUID.test(id) || !this.identity) return null;
    id=id.toLowerCase();
    const scope = this.identity, epoch = this.epoch;
    const entry = this.sessions.get(id);
    if (usableMetrics(entry?.data)) return { ...entry.data, transcriptRestoredFromHistory:!!entry.data.transcriptStats, restoredFromHistory: true, savedAt: entry.savedAt || null };
    const saved = await this.history.load(scope,id);
    if (!this.owned() || scope !== this.identity || epoch !== this.epoch) return null;
    if (!saved) return null;
    if (!this.sessions.has(id)) this.sessions.set(id,{data:saved.metrics,savedAt:saved.savedAt,updatedAt:0});
    return {...saved.metrics,transcriptRestoredFromHistory:!!saved.metrics.transcriptStats,restoredFromHistory:true,savedAt:saved.savedAt};
  }

  async refreshQuota(force = false) {
    if (!this.owned()) throw new Error('后台已重新连接，请等待刷新');
    if (!force && this.quota && Date.now() - this.quotaAt < 60000) return;
    if (this.quotaPending) return this.quotaPending;
    const epoch = this.epoch;
    this.quotaPending = (async () => {
      const user = await this.client.call('GetUserStatus');
      if (!this.owned() || epoch !== this.epoch) throw new Error('后台已重新连接，请等待刷新');
      const email = user.userStatus?.email;
      const identity = email ? createHash('sha256').update(email).digest('hex') : null;
      if (identity !== this.identity) { this.delegated.reset();this.transcripts?.reset(); this.client.resetTrajectories?.(); this.quota = null; this.quotaAt = 0; this.sessions.clear(); this.summaries = []; this.summariesAt = 0; }
      this.identity = identity;
      const response = await this.client.call('RetrieveUserQuotaSummary');
      if (!this.owned() || epoch !== this.epoch || identity !== this.identity) throw new Error('后台已重新连接，请等待刷新');
      this.quota = quotaMetrics(response);
      this.quotaAt = Date.now();
    })().finally(() => { this.quotaPending = null; });
    return this.quotaPending;
  }

  async listConversations(force = false) {
    if (!this.owned()) throw new Error('后台已重新连接，请等待刷新');
    if (!force && Date.now() - this.summariesAt < 5000) return this.summaries;
    const scope = this.identity, epoch = this.epoch;
    const response = await this.client.call('GetAllCascadeTrajectories',{excludeSubtrajectories:false});
    if (!this.owned() || scope !== this.identity || epoch !== this.epoch) throw new Error('后台已重新连接，请等待刷新');
    this.summaries = Object.entries(response.trajectorySummaries || {}).map(([id, value]) => ({
      id, title: value.summary || '未命名会话', modifiedAt: value.lastModifiedTime, status: value.status,stepCount:value.stepCount,lastUserInputStepIndex:value.lastUserInputStepIndex,
    })).sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
    this.summariesAt = Date.now();
    return this.summaries;
  }

  async session(id, force = false) {
    if (!GUID.test(id)) throw new Error('会话标识无效');
    if (!this.owned()) throw new Error('后台已重新连接，请等待刷新');
    id=id.toLowerCase();
    const scope = this.identity, epoch = this.epoch;
    let entry = this.sessions.get(id);
    if (entry?.pending) return entry.pending;
    if (!force && entry?.data && Date.now() - entry.updatedAt < 1800) return entry.data;
    entry ||= {};
    this.sessions.set(id, entry);
    const current = () => this.owned() && scope === this.identity && epoch === this.epoch && this.sessions.get(id) === entry;
    entry.pending = (async () => {
      if (!entry.data && scope) {
        const saved = await this.history.load(scope,id);
        if (!current()) throw new Error('后台已重新连接，请等待刷新');
        if (saved) { entry.data = saved.metrics; entry.savedAt = saved.savedAt; }
      }
      const raw = await this.client.trajectory(id,{force,isCurrent:current});
      if (!current()) throw new Error('后台已重新连接，请等待刷新');
      if(this.onTrajectory&&scope){try{await this.onTrajectory(scope,id,raw);if(current())this.usagePersistenceError=false;}catch{if(current())this.usagePersistenceError=true;}}
      if (!current()) throw new Error('后台已重新连接，请等待刷新');
      const fresh = trajectoryMetrics(raw);
      fresh.delegatedConversations=[...new Set([...delegatedIds(id,raw,this.client.reader?.summaries||{}),...(entry.data?.delegatedConversations||[])])].slice(0,128);
      fresh.taskUsage=this.delegated.request(scope,id,raw,{saved:entry.data?.taskUsage,knownIds:fresh.delegatedConversations,force,isCurrent:current});
      // Optional background I/O cannot delay or fail the core metrics request.
      try { if(scope&&this.transcripts)fresh.transcriptStats=this.transcripts.request(scope,id,raw); } catch {}
      entry.data = {...reconcileMetrics(entry.data,fresh,entry.savedAt || null),conversationId:id}; entry.updatedAt = Date.now();
      try { const saved = await this.history.save(scope,id,entry.data,{isCurrent:current}); if (saved&&current()) entry.savedAt = saved.savedAt; if (current()) this.persistenceError = null; }
      catch { if(current())this.persistenceError = '统计暂时无法保存到本地'; }
      if (!current()) throw new Error('后台已重新连接，请等待刷新');
      return entry.data;
    })().catch(error => {
      if (current() && usableMetrics(entry.data)) { entry.updatedAt = Date.now(); entry.data = {...entry.data,transcriptRestoredFromHistory:!!entry.data.transcriptStats,restoredFromHistory:true,savedAt:entry.savedAt || null}; return entry.data; }
      throw error;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  async snapshot({ conversationId, force = false, selectLatest = true } = {}) {
    let connection = 'live', error = null, speed = null, sessionError = null;
    try {
      if (!this.owned()) throw new Error('后台已重新连接，请等待刷新');
      const server = await this.client.discover();
      if (!this.owned()) throw new Error('后台已重新连接，请等待刷新');
      if (server.pid !== this.serverPid) {
        this.epoch++; this.delegated.reset();this.transcripts?.reset(); this.quota = null; this.quotaAt = 0; this.sessions.clear(); this.identity = null; this.summaries = []; this.summariesAt = 0; this.serverPid = server.pid;
      }
      try { await this.refreshQuota(force); }
      catch (e) { connection = this.quota ? 'stale' : 'offline'; error = e.message; }
      let summaries = this.summaries;
      // The inline composer already supplies its exact ID. Enumerating every
      // conversation first adds unrelated RPC latency to a route transition.
      // An unresolved inline composer must not read an unrelated recent chat.
      // Standalone panels retain their default automatic conversation selection.
      if (!conversationId && selectLatest !== false) {
        try { summaries = await this.listConversations(force); }
        catch (e) { connection = this.quota ? 'stale' : 'offline'; error ||= e.message; }
      }
      const selected = conversationId || (selectLatest !== false ? summaries[0]?.id : null);
      if (selected) {
        try { speed = await this.session(selected, force); }
        catch (e) { sessionError = e.message; }
      }
    } catch (e) {
      connection = this.quota ? 'stale' : 'offline'; error = e.message;
      if (conversationId) speed = await this.cachedSession(conversationId);
    }
    return {
      connection, error, sessionError, serverTime: new Date().toISOString(),
      quotaUpdatedAt: this.quotaAt ? new Date(this.quotaAt).toISOString() : null,
      groups: this.quota || [], speed, conversations: this.summaries,
      persistenceError: this.persistenceError,
      source: 'Antigravity local API',
    };
  }

  async cascadeRunState(conversationId, { force = false } = {}) {
    if (!this.owned() || !conversationId || !GUID.test(conversationId)) return null;
    const id = conversationId.toLowerCase();
    const reader = this.client?.reader;
    if (!reader) return null;
    const isRunning = s => Boolean(s && !/IDLE|DONE|COMPLETED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR/i.test(String(s)));
    const isSettled = s => Boolean(s && /IDLE|DONE|COMPLETED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR/i.test(String(s)));
    try {
      const now = typeof this.client?.now === 'function' ? this.client.now() : Date.now();
      const age = Number.isFinite(reader.summaryAt) ? now - reader.summaryAt : Infinity;
      const prevActive = this._activeCascades?.has(id) === true;
      if (typeof reader.summary === 'function' && (force || !reader.summaries || age >= (prevActive ? 900 : 1500))) {
        await reader.summary(id, null, true).catch(() => null);
      }
    } catch {}
    const summaries = reader.summaries;
    if (!summaries || typeof summaries !== 'object') return null;

    const normalized = new Map();
    for (const [rawKey, val] of Object.entries(summaries)) {
      if (val && typeof val === 'object') normalized.set(String(rawKey).toLowerCase(), val);
    }

    const knownDelegated = this.sessions.get(id)?.data?.delegatedConversations || [];
    const descendants = new Set(
      knownDelegated.map(x => String(x || '').toLowerCase()).filter(x => GUID.test(x) && x !== id)
    );
    let expanded = true;
    while (expanded && descendants.size < 256) {
      expanded = false;
      for (const [cid, cs] of normalized) {
        if (cid === id || descendants.has(cid)) continue;
        const pId = String(cs?.trajectoryMetadata?.parentConversationId || '').toLowerCase();
        const rId = String(cs?.trajectoryMetadata?.rootConversationId || '').toLowerCase();
        if (pId === id || rId === id || (pId && descendants.has(pId)) || (rId && descendants.has(rId))) {
          descendants.add(cid);
          expanded = true;
          if (descendants.size >= 256) break;
        }
      }
    }

    const runningSubagentIds = [];
    let latestSubagentModifiedMs = 0;
    let latestRunningSubagentModifiedMs = 0;
    for (const cid of descendants) {
      const cs = normalized.get(cid);
      if (!cs) continue;
      const modMs = Date.parse(cs.lastModifiedTime || '') || 0;
      if (modMs > latestSubagentModifiedMs) latestSubagentModifiedMs = modMs;
      const childActive = isRunning(cs.status) || cs.hasActiveChildren === true || cs.hasRunningSubagents === true || cs.notFullyIdle === true;
      if (childActive) {
        runningSubagentIds.push(cid);
        if (modMs > latestRunningSubagentModifiedMs) latestRunningSubagentModifiedMs = modMs;
      }
    }

    const selfSummary = normalized.get(id) || null;
    const selfHasActiveChildren = Boolean(selfSummary && (selfSummary.hasActiveChildren === true || selfSummary.hasRunningSubagents === true));
    const selfRunning = Boolean(selfSummary && (isRunning(selfSummary.status) || selfSummary.notFullyIdle === true));
    const selfSettled = Boolean(selfSummary && isSettled(selfSummary.status) && !selfHasActiveChildren && runningSubagentIds.length === 0);
    const selfModifiedMs = Date.parse(selfSummary?.lastModifiedTime || '') || 0;

    this._activeCascades ||= new Set();
    if (selfRunning || selfHasActiveChildren || runningSubagentIds.length > 0) this._activeCascades.add(id);
    else this._activeCascades.delete(id);

    return {
      selfStatus: selfSummary?.status || null,
      selfRunning,
      selfSettled,
      selfHasActiveChildren,
      selfModifiedMs,
      totalSubagents: descendants.size,
      runningSubagents: runningSubagentIds.length,
      runningSubagentIds,
      latestSubagentModifiedMs,
      latestRunningSubagentModifiedMs,
    };
  }
  dispose(){this.disposed=true;this.delegated.dispose();this.transcripts?.reset();this.epoch++;}
}
