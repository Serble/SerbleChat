// Discord's end-to-end encryption (DAVE, https://daveprotocol.com) for one voice or stream connection.
// The MLS work is done by @snazzah/davey; this tracks transitions and epochs the way the voice server
// expects, following davey's usage guide (davey 0.2 needs transitions prepared and executed on its
// session explicitly) and @discordjs/voice's DAVESession (MIT, Copyright 2021 Noel Buechler, Amish
// Shah, Vlad Frangu, Aura Román and contributors).

const { EventEmitter } = require('events');
const Davey = require('@snazzah/davey');

const TRANSITION_EXPIRY = 10;
const TRANSITION_EXPIRY_PENDING_DOWNGRADE = 24;
const FAILURE_TOLERANCE = 36;
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

class DaveSession extends EventEmitter {
  constructor(protocolVersion, userId, channelId, log) {
    super();
    this.protocolVersion = protocolVersion;
    this.userId = userId;
    this.channelId = channelId;
    this.log = log;
    this.session = null;
    this.pendingTransitions = new Map();
    this.lastTransitionId = undefined;
    this.downgraded = false;
    this.reinitializing = false;
    this.consecutiveFailures = 0;
  }

  static get maxProtocolVersion() {
    return Davey.DAVE_PROTOCOL_VERSION;
  }

  get privacyCode() {
    return this.protocolVersion && this.session?.voicePrivacyCode ? this.session.voicePrivacyCode : null;
  }

  reinit() {
    if (this.protocolVersion > 0) {
      if (this.session) this.session.reinit(this.protocolVersion, this.userId, this.channelId);
      else this.session = new Davey.DAVESession(this.protocolVersion, this.userId, this.channelId);
      if (this.downgraded) this.session.setPassthroughMode(true, TRANSITION_EXPIRY);
      this.emit('keyPackage', this.session.getSerializedKeyPackage());
    } else if (this.session) {
      this.session.reset();
      this.session.setPassthroughMode(true, TRANSITION_EXPIRY);
    }
  }

  setExternalSender(data) {
    this.session?.setExternalSender(data);
  }

  /** @returns whether to tell the server we're ready for it */
  prepareTransition({ transition_id: id, protocol_version: version }) {
    this.pendingTransitions.set(id, version);
    try {
      this.session?.prepareTransition(id, version);
    } catch (err) {
      this.log.warn(`DAVE: preparing transition ${id} failed: ${err.message}`);
    }
    if (id === 0) {
      this.executeTransition(id);
      return false;
    }
    if (version === 0) this.session?.setPassthroughMode(true, TRANSITION_EXPIRY_PENDING_DOWNGRADE);
    return true;
  }

  executeTransition(id) {
    if (!this.pendingTransitions.has(id)) return false;
    // Transition 0 was executed when it was prepared
    if (id !== 0) {
      try {
        this.session?.executeTransition(id);
      } catch (err) {
        this.log.warn(`DAVE: executing transition ${id} failed: ${err.message}`);
      }
    }
    const oldVersion = this.protocolVersion;
    this.protocolVersion = this.pendingTransitions.get(id);
    if (oldVersion !== this.protocolVersion && this.protocolVersion === 0) {
      this.downgraded = true;
    } else if (id > 0 && this.downgraded) {
      this.downgraded = false;
      // Upgraded again: keep letting unencrypted packets through briefly, for ones still in flight
      this.session?.setPassthroughMode(false, TRANSITION_EXPIRY);
    }
    this.reinitializing = false;
    this.lastTransitionId = id;
    this.pendingTransitions.delete(id);
    this.emit('transitioned', id);
    return true;
  }

  prepareEpoch({ epoch, protocol_version: version }) {
    if (epoch === 1) {
      this.protocolVersion = version;
      this.reinit();
    }
  }

  recoverFromInvalidTransition(id) {
    if (this.reinitializing) return;
    this.reinitializing = true;
    this.consecutiveFailures = 0;
    this.emit('invalidateTransition', id);
    this.reinit();
  }

  /** @returns the commit (+ welcome) to send back, if any */
  processProposals(payload, connectedClients) {
    if (!this.session) return null;
    const { commit, welcome } = this.session.processProposals(payload.readUInt8(0), payload.subarray(1), this.recognized(connectedClients));
    if (!commit) return null;
    return welcome ? Buffer.concat([commit, welcome]) : commit;
  }

  processCommit(payload) {
    // A falsy result means the commit isn't for us to act on
    return this.processTransitionMessage(payload, data => this.session.processCommit(data) !== false);
  }

  processWelcome(payload, connectedClients) {
    return this.processTransitionMessage(payload, data => { this.session.processWelcome(data, this.recognized(connectedClients)); return true; });
  }

  /** Who may be in the group: everyone the voice server says is connected, and us. */
  recognized(connectedClients) {
    return [...new Set([...connectedClients, this.userId])];
  }

  processTransitionMessage(payload, process) {
    const transitionId = payload.readUInt16BE(0);
    if (!this.session) return { transitionId, success: false };
    try {
      if (!process(payload.subarray(2))) return { transitionId, success: false };
      this.session.prepareTransition(transitionId, this.protocolVersion);
      if (transitionId === 0) {
        this.reinitializing = false;
        this.lastTransitionId = transitionId;
      } else {
        this.pendingTransitions.set(transitionId, this.protocolVersion);
      }
      return { transitionId, success: true };
    } catch (err) {
      this.log.warn(`DAVE: transition ${transitionId} failed: ${err.message}`);
      this.recoverFromInvalidTransition(transitionId);
      return { transitionId, success: false };
    }
  }

  /** @returns the packet to send, or null while it can't be encrypted (between joining and the keys being in use) */
  encryptOpus(packet) {
    if (this.protocolVersion === 0 || packet.equals(SILENCE_FRAME)) return packet;
    if (!this.session?.ready || !this.session.canEncrypt) return null;
    try {
      return this.session.encryptOpus(packet);
    } catch {
      return null;
    }
  }

  /** @returns the decrypted media, or null if it can't be decrypted (yet) */
  decrypt(userId, mediaType, packet) {
    if (mediaType === Davey.MediaType.AUDIO && packet.equals(SILENCE_FRAME)) return packet;
    // Before the group's keys are in, encrypted media can't be read: drop it (rather than play noise)
    if (!this.session) return this.protocolVersion === 0 ? packet : null;
    if (!this.session.ready) return this.protocolVersion === 0 || this.session.canPassthrough(userId) ? packet : null;
    try {
      const out = this.session.decrypt(userId, mediaType, packet);
      this.consecutiveFailures = 0;
      return out;
    } catch {
      if (!this.reinitializing && this.pendingTransitions.size === 0) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures > FAILURE_TOLERANCE && this.lastTransitionId !== undefined) {
          this.recoverFromInvalidTransition(this.lastTransitionId);
        }
      }
      return null;
    }
  }

  destroy() {
    try { this.session?.reset(); } catch { /* already gone */ }
  }
}

module.exports = { DaveSession, MediaType: Davey.MediaType, SILENCE_FRAME };
