import { create } from 'zustand';
import { useUserStateStore } from '../store';

/**
 * Unified Combat State Store
 * 
 * This store consolidates all combat-related state including:
 * - Player health (own and others)
 * - Damage rendering
 * - Combat status
 * - Death/respawn states
 * 
 * Prevents race conditions by managing health and damage updates atomically.
 */
export const useCombatStore = create((set, get) => ({
  // Player health data - single source of truth
  playerHealths: {}, // playerId -> { current: number, max: number, lastUpdated: timestamp }

  // Damage display data
  damageToRender: {}, // playerId -> { damage: number, timestamp: number, id: string }

  // Optimistic damage tracking
  optimisticDamage: {}, // playerId -> { damage: number, timestamp: number, transactionId: string, attackerId: string, isPending: boolean }
  pendingVerifications: {}, // transactionId -> { playerId: string, damage: number, attackerId: string, timestamp: number }

  // Combat status
  combatStates: {}, // playerId -> { inCombat: boolean, isAttacking: boolean, lastAttack: timestamp }

  // Death states
  deathStates: {}, // playerId -> { isDead: boolean, isRespawning: boolean, deathTime: timestamp }

  // Actions for health management
  setPlayerHealth: (playerId, health, maxHealth = 30) => {
    set((state) => {
      const timestamp = Date.now();
      console.log(`❤️ Combat Store: Setting health for ${playerId}: ${health}/${maxHealth}`);
      
      const newHealths = {
        ...state.playerHealths,
        [playerId]: {
          current: Math.max(0, health),
          max: maxHealth,
          lastUpdated: timestamp,
        },
      };

      // Update death state if health reaches 0
      const newDeathStates = { ...state.deathStates };
      if (health <= 0 && (!state.deathStates[playerId] || !state.deathStates[playerId].isDead)) {
        newDeathStates[playerId] = {
          isDead: true,
          isRespawning: false,
          deathTime: timestamp,
        };
        console.log(`💀 Combat Store: Player ${playerId} died`);

        // Clear any targeting of this dead player
        const { clearTargetingPlayer } = useUserStateStore.getState();
        clearTargetingPlayer(playerId);
        console.log(`🎯 Cleared targeting of dead player ${playerId}`);
      } else if (health > 0 && state.deathStates[playerId]?.isDead) {
        newDeathStates[playerId] = {
          isDead: false,
          isRespawning: false,
          deathTime: null,
        };
        console.log(`✨ Combat Store: Player ${playerId} respawned`);
      }

      return {
        playerHealths: newHealths,
        deathStates: newDeathStates,
      };
    });
  },

  // Optimistic damage application - immediate client-side update
  applyOptimisticDamage: (attackerId, targetId, estimatedDamage = 2) => {
    const transactionId = `opt-${attackerId}-${targetId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    set((state) => {
      const timestamp = Date.now();

      console.log(`⚡ Combat Store: Applying optimistic damage ${estimatedDamage} from ${attackerId} to ${targetId} (txn: ${transactionId})`);

      // Add optimistic damage display
      const newOptimisticDamage = {
        ...state.optimisticDamage,
        [targetId]: {
          damage: estimatedDamage,
          timestamp,
          transactionId,
          attackerId,
          isPending: true,
        },
      };

      // Track pending verification
      const newPendingVerifications = {
        ...state.pendingVerifications,
        [transactionId]: {
          playerId: targetId,
          damage: estimatedDamage,
          attackerId,
          timestamp,
        },
      };

      // Update combat states optimistically
      const newCombatStates = {
        ...state.combatStates,
        [attackerId]: {
          ...state.combatStates[attackerId],
          inCombat: true,
          isAttacking: true,
          lastAttack: timestamp,
        },
        [targetId]: {
          ...state.combatStates[targetId],
          inCombat: true,
          isAttacking: false,
          lastAttack: state.combatStates[targetId]?.lastAttack || 0,
        },
      };

      return {
        optimisticDamage: newOptimisticDamage,
        pendingVerifications: newPendingVerifications,
        combatStates: newCombatStates,
      };
    });

    return transactionId;
  },

  // Atomic damage and health update - prevents race conditions (server-confirmed)
  applyDamageAndUpdateHealth: (attackerId, targetId, damage, newHealth, maxHealth = 30, transactionId = null) => {
    set((state) => {
      const timestamp = Date.now();
      const damageId = `${attackerId}-${targetId}-${timestamp}`;

      console.log(`💥 Combat Store: Applying confirmed damage ${damage} from ${attackerId} to ${targetId}, new health: ${newHealth}${transactionId ? ` (txn: ${transactionId})` : ''}`);

      // Clear optimistic damage if this is a confirmation
      const newOptimisticDamage = { ...state.optimisticDamage };
      const newPendingVerifications = { ...state.pendingVerifications };

      if (transactionId && state.pendingVerifications[transactionId]) {
        delete newOptimisticDamage[targetId];
        delete newPendingVerifications[transactionId];
        console.log(`✅ Combat Store: Confirmed optimistic damage (txn: ${transactionId})`);
      }

      // Update damage to render
      const newDamageToRender = {
        ...state.damageToRender,
        [targetId]: {
          damage,
          timestamp,
          id: damageId,
          attackerId,
          isConfirmed: true,
        },
      };

      // Update target health - clear optimistic flags and set confirmed health
      const currentHealth = state.playerHealths[targetId];
      const wasOptimistic = currentHealth?.isOptimistic;

      const newHealths = {
        ...state.playerHealths,
        [targetId]: {
          current: Math.max(0, newHealth),
          max: maxHealth,
          lastUpdated: timestamp,
          isOptimistic: false, // Clear optimistic flag
          optimisticTransactionId: null, // Clear transaction ID
          originalHealth: null, // Clear original health backup
        },
      };

      if (wasOptimistic) {
        console.log(`✅ Combat Store: Confirmed optimistic health update - ${targetId} health confirmed at: ${newHealth}`);
      }

      // Update death state if health reaches 0
      const newDeathStates = { ...state.deathStates };
      if (newHealth <= 0 && (!state.deathStates[targetId] || !state.deathStates[targetId].isDead)) {
        newDeathStates[targetId] = {
          isDead: true,
          isRespawning: false,
          deathTime: timestamp,
        };
        console.log(`💀 Combat Store: Player ${targetId} died from damage`);

        // Clear any targeting of this dead player
        const { clearTargetingPlayer } = useUserStateStore.getState();
        clearTargetingPlayer(targetId);
        console.log(`🎯 Cleared targeting of dead player ${targetId}`);
      }

      // Update combat states
      const newCombatStates = {
        ...state.combatStates,
        [attackerId]: {
          ...state.combatStates[attackerId],
          inCombat: true,
          isAttacking: true,
          lastAttack: timestamp,
        },
        [targetId]: {
          ...state.combatStates[targetId],
          inCombat: true,
          isAttacking: false,
          lastAttack: state.combatStates[targetId]?.lastAttack || 0,
        },
      };

      return {
        damageToRender: newDamageToRender,
        playerHealths: newHealths,
        deathStates: newDeathStates,
        combatStates: newCombatStates,
        optimisticDamage: newOptimisticDamage,
        pendingVerifications: newPendingVerifications,
      };
    });
  },

  // Apply optimistic damage from server broadcast (different from client-side optimistic)
  applyServerOptimisticDamage: (attackerId, targetId, damage, transactionId = null) => {
    set((state) => {
      const timestamp = Date.now();
      const damageId = `${attackerId}-${targetId}-${timestamp}`;

      console.log(`⚡ Combat Store: Applying server optimistic damage ${damage} from ${attackerId} to ${targetId}${transactionId ? ` (txn: ${transactionId})` : ''}`);

      // Add damage to render immediately
      const newDamageToRender = {
        ...state.damageToRender,
        [targetId]: {
          damage,
          timestamp,
          id: damageId,
          attackerId,
          isOptimistic: true, // Mark as optimistic for potential correction
          transactionId,
        },
      };

      // Apply optimistic health update for immediate visual feedback
      const currentHealth = state.playerHealths[targetId];

      // Initialize health if it doesn't exist (default to 30/30)
      const healthToUse = currentHealth || { current: 30, max: 30, lastUpdated: timestamp };
      const newOptimisticHealth = Math.max(0, healthToUse.current - damage);

      const newHealths = {
        ...state.playerHealths,
        [targetId]: {
          ...healthToUse,
          current: newOptimisticHealth,
          lastUpdated: timestamp,
          isOptimistic: true, // Mark as optimistic for potential rollback
          optimisticTransactionId: transactionId,
          originalHealth: healthToUse.current, // Store original for rollback
        },
      };

      console.log(`⚡ Combat Store: Optimistic health update - ${targetId} health: ${healthToUse.current} → ${newOptimisticHealth}`);

      return {
        damageToRender: newDamageToRender,
        playerHealths: newHealths,
      };
    });
  },

  // Rollback optimistic damage when server rejects
  rollbackOptimisticDamage: (transactionId, reason = 'Server rejected') => {
    set((state) => {
      const pendingUpdate = state.pendingVerifications[transactionId];
      if (!pendingUpdate) {
        console.warn(`⚠️ Combat Store: Cannot rollback unknown transaction ${transactionId}`);
        return state;
      }

      const { playerId } = pendingUpdate;
      console.log(`🔄 Combat Store: Rolling back optimistic damage for ${playerId} (txn: ${transactionId}) - ${reason}`);

      // Remove optimistic damage and pending verification
      const newOptimisticDamage = { ...state.optimisticDamage };
      const newPendingVerifications = { ...state.pendingVerifications };

      delete newOptimisticDamage[playerId];
      delete newPendingVerifications[transactionId];

      // Rollback optimistic health if it exists
      const currentHealth = state.playerHealths[playerId];
      const newHealths = { ...state.playerHealths };

      if (currentHealth?.isOptimistic && currentHealth.optimisticTransactionId === transactionId) {
        console.log(`🔄 Combat Store: Rolling back optimistic health for ${playerId} from ${currentHealth.current} to ${currentHealth.originalHealth}`);
        newHealths[playerId] = {
          ...currentHealth,
          current: currentHealth.originalHealth, // Restore original health
          isOptimistic: false,
          optimisticTransactionId: null,
          originalHealth: null,
          lastUpdated: Date.now(),
        };
      }

      // Clear damage display for rollbacks
      const newDamageToRender = { ...state.damageToRender };
      delete newDamageToRender[playerId];

      return {
        optimisticDamage: newOptimisticDamage,
        pendingVerifications: newPendingVerifications,
        playerHealths: newHealths,
        damageToRender: newDamageToRender,
      };
    });
  },

  // Clear damage display after animation
  clearDamageDisplay: (playerId) => {
    set((state) => {
      const newDamageToRender = { ...state.damageToRender };
      const newOptimisticDamage = { ...state.optimisticDamage };

      delete newDamageToRender[playerId];
      delete newOptimisticDamage[playerId];

      console.log(`💥 Combat Store: Cleared damage display for ${playerId}`);

      return {
        damageToRender: newDamageToRender,
        optimisticDamage: newOptimisticDamage,
      };
    });
  },

  // Update combat state
  setCombatState: (playerId, inCombat, isAttacking = false) => {
    set((state) => ({
      combatStates: {
        ...state.combatStates,
        [playerId]: {
          ...state.combatStates[playerId],
          inCombat,
          isAttacking,
          lastAttack: isAttacking ? Date.now() : (state.combatStates[playerId]?.lastAttack || 0),
        },
      },
    }));
  },

  // Update death/respawn state
  setDeathState: (playerId, isDead, isRespawning = false) => {
    set((state) => {
      const timestamp = Date.now();
      console.log(`💀 Combat Store: Setting death state for ${playerId}: dead=${isDead}, respawning=${isRespawning}`);

      // Clear any targeting of this player if they died
      if (isDead && (!state.deathStates[playerId] || !state.deathStates[playerId].isDead)) {
        const { clearTargetingPlayer } = useUserStateStore.getState();
        clearTargetingPlayer(playerId);
        console.log(`🎯 Cleared targeting of dead player ${playerId}`);
      }

      return {
        deathStates: {
          ...state.deathStates,
          [playerId]: {
            isDead,
            isRespawning,
            deathTime: isDead ? timestamp : null,
          },
        },
      };
    });
  },

  // Getters for computed values
  getPlayerHealth: (playerId) => {
    const state = get();
    return state.playerHealths[playerId] || { current: 30, max: 30, lastUpdated: 0 };
  },

  getPlayerDamage: (playerId) => {
    const state = get();
    // Prioritize confirmed damage over optimistic damage
    const confirmedDamage = state.damageToRender[playerId];
    const optimisticDamage = state.optimisticDamage[playerId];

    if (confirmedDamage) {
      return confirmedDamage;
    } else if (optimisticDamage) {
      return {
        ...optimisticDamage,
        isOptimistic: true,
      };
    }
    return null;
  },

  getOptimisticDamage: (playerId) => {
    const state = get();
    return state.optimisticDamage[playerId] || null;
  },

  getPendingVerifications: () => {
    const state = get();
    return state.pendingVerifications;
  },

  getPlayerCombatState: (playerId) => {
    const state = get();
    return state.combatStates[playerId] || { inCombat: false, isAttacking: false, lastAttack: 0 };
  },

  getPlayerDeathState: (playerId) => {
    const state = get();
    return state.deathStates[playerId] || { isDead: false, isRespawning: false, deathTime: null };
  },

  // Cleanup expired combat states
  cleanupExpiredStates: () => {
    set((state) => {
      const now = Date.now();
      const COMBAT_TIMEOUT = 10000; // 10 seconds
      const DAMAGE_TIMEOUT = 2000; // 2 seconds
      const OPTIMISTIC_TIMEOUT = 5000; // 5 seconds for optimistic damage

      // Clean up expired combat states
      const newCombatStates = { ...state.combatStates };
      Object.keys(newCombatStates).forEach(playerId => {
        const combatState = newCombatStates[playerId];
        if (combatState.inCombat && (now - combatState.lastAttack) > COMBAT_TIMEOUT) {
          newCombatStates[playerId] = {
            ...combatState,
            inCombat: false,
            isAttacking: false,
          };
        }
      });

      // Clean up expired damage displays
      const newDamageToRender = { ...state.damageToRender };
      Object.keys(newDamageToRender).forEach(playerId => {
        const damage = newDamageToRender[playerId];
        if (damage && (now - damage.timestamp) > DAMAGE_TIMEOUT) {
          delete newDamageToRender[playerId];
        }
      });

      // Clean up expired optimistic damage (auto-rollback)
      const newOptimisticDamage = { ...state.optimisticDamage };
      const newPendingVerifications = { ...state.pendingVerifications };

      Object.keys(newOptimisticDamage).forEach(playerId => {
        const optimisticDamage = newOptimisticDamage[playerId];
        if (optimisticDamage && (now - optimisticDamage.timestamp) > OPTIMISTIC_TIMEOUT) {
          console.warn(`⏰ Combat Store: Auto-rolling back expired optimistic damage for ${playerId} (txn: ${optimisticDamage.transactionId})`);
          delete newOptimisticDamage[playerId];
          delete newPendingVerifications[optimisticDamage.transactionId];
        }
      });

      return {
        combatStates: newCombatStates,
        damageToRender: newDamageToRender,
        optimisticDamage: newOptimisticDamage,
        pendingVerifications: newPendingVerifications,
      };
    });
  },

  // Reset all combat state (useful for disconnections)
  resetCombatState: () => {
    set(() => ({
      playerHealths: {},
      damageToRender: {},
      optimisticDamage: {},
      pendingVerifications: {},
      combatStates: {},
      deathStates: {},
    }));
    console.log('🔄 Combat Store: Reset all combat state');
  },
}));
