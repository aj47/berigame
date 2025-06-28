import React, { useEffect } from "react";
import {
  useChatStore,
  useOtherUsersStore,
  useUserStateStore,
  useWebsocketStore,
  useHarvestStore,
  useInventoryStore,
  useGroundItemsStore,
  useLoadingStore,
} from "../store";
import { useCombatStore } from "../stores/combatStore";
import { connectToChatRoom } from "../Api";

const Api = (props) => {
  let wsUrl = "wss://w6et9cl8r6.execute-api.ap-southeast-2.amazonaws.com/dev/";
  const setWebSocket = useWebsocketStore((state: any) => state.setWebSocket);
  const websocketConnection = useWebsocketStore(
    (state: any) => state.websocketConnection
  );
  const setAllConnections = useWebsocketStore(
    (state: any) => state.setAllConnections
  );
  const allConnections = useWebsocketStore(
    (state: any) => state.allConnections
  );
  const addChatMessage = useChatStore((state: any) => state.addChatMessage);
  const setUserPosition = useOtherUsersStore(
    (state: any) => state.setUserPosition
  );
  // Combat store actions - replacing old damage and health management
  const {
    applyDamageAndUpdateHealth,
    applyServerOptimisticDamage,
    setPlayerHealth,
    rollbackOptimisticDamage
  } = useCombatStore();
  const setUserConnectionId = useUserStateStore(
    (state: any) => state.setUserConnectionId
  );
  const userConnectionId = useUserStateStore(
    (state: any) => state.userConnectionId
  );

  const startHarvest = useHarvestStore((state: any) => state.startHarvest);
  const completeHarvest = useHarvestStore(
    (state: any) => state.completeHarvest
  );
  const cancelHarvest = useHarvestStore((state: any) => state.cancelHarvest);
  const addItem = useInventoryStore((state: any) => state.addItem);
  const removeItem = useInventoryStore((state: any) => state.removeItem);
  const clearInventory = useInventoryStore((state: any) => state.clearInventory);
  const shouldValidate = useInventoryStore((state: any) => state.shouldValidate);
  const markValidated = useInventoryStore((state: any) => state.markValidated);
  // Combat store actions for death/health management
  const { setDeathState } = useCombatStore();
  const setPositionCorrection = useUserStateStore((state: any) => state.setPositionCorrection);
  const addGroundItem = useGroundItemsStore((state: any) => state.addGroundItem);
  const addGroundItemAndCleanup = useGroundItemsStore((state: any) => state.addGroundItemAndCleanup);
  const removeGroundItem = useGroundItemsStore((state: any) => state.removeGroundItem);
  const confirmPickupCompleted = useGroundItemsStore((state: any) => state.confirmPickupCompleted);
  const clearGroundItems = useGroundItemsStore((state: any) => state.clearGroundItems);
  const syncGroundItems = useGroundItemsStore((state: any) => state.syncGroundItems);
  const setWebsocketConnected = useLoadingStore((state: any) => state.setWebsocketConnected);
  const setGameDataLoaded = useLoadingStore((state: any) => state.setGameDataLoaded);

  if (process.env.NODE_ENV === "development") {
    wsUrl = "ws://localhost:3001";
  }
  let clientConnectionId = null;

  useEffect(() => {
    if (websocketConnection)
      websocketConnection.onmessage = _webSocketMessageReceived;
  }, [allConnections]);

  const updateUserPosition = (newData: any) => {
    newData.selfDestroyTime = new Date().getTime() + 5000;
    setUserPosition(newData);
    if (allConnections && allConnections.indexOf(newData.connectionId) === -1) {
      setAllConnections([...allConnections, newData.connectionId]);
    }
  };

  const handlePositionCorrection = (correctionData: any) => {
    console.log("Server corrected position:", correctionData);

    // Store the correction data for the PlayerController to handle
    setPositionCorrection({
      correctedPosition: correctionData.correctedPosition,
      reason: correctionData.reason,
      timestamp: correctionData.timestamp
    });

    // Show user feedback (optional - could be removed to not reveal anti-cheat)
    if (correctionData.reason === "boundary_violation") {
      console.warn("Movement was outside game boundaries");
    } else if (correctionData.reason === "speed_violation") {
      console.warn("Movement was too fast");
    } else if (correctionData.reason === "teleportation_detected") {
      console.warn("Invalid movement detected");
    }
  };

  const updateConnections = (connections: any) => {
    const tempAllConnections = [];
    for (const item of connections) {
      tempAllConnections.push(item.SK.split("#")[1]);
    }
    setAllConnections(tempAllConnections);
  };

  const _webSocketMessageReceived = (e) => {
    if (e.data) {
      const messageObject = JSON.parse(e.data);

      if (messageObject.chatMessage) {
        addChatMessage(messageObject);
      }

      // Handle position corrections from server
      if (messageObject.type === "positionCorrection") {
        console.warn("Position corrected by server:", messageObject.reason);
        handlePositionCorrection(messageObject);
        return;
      }

      if (messageObject.position && messageObject.userId) {
        updateUserPosition(messageObject);
        if (messageObject.attackingPlayer && messageObject.damageGiven) {
          // Use unified combat store for atomic damage and health updates
          const damageInfo = messageObject.damageGiven;
          const attackerId = messageObject.attackingPlayer;
          const targetId = damageInfo.receivingPlayer;
          const damage = damageInfo.damage;
          const newHealth = damageInfo.newHealth;

          // Check if this is a verification response for an optimistic attack
          const transactionId = damageInfo.optimisticTransactionId;

          // Process damage display based on attack type using unified combat store
          if (damageInfo.isOptimistic) {
            // This is an optimistic broadcast from server - show damage but don't update health yet
            console.log(`⚡ Processing optimistic damage: ${damage} damage to ${targetId} (txn: ${transactionId})`);
            applyServerOptimisticDamage(attackerId, targetId, damage, transactionId);
          } else if (damageInfo.attackType === 'hit') {
            // Show damage numbers for successful hits (including 0 damage)
            console.log(`💥 Processing confirmed hit: ${damage} damage to ${targetId} (type: ${damageInfo.attackType})`);
            if (newHealth !== undefined) {
              // Apply damage and update health atomically to prevent race conditions
              // Include transaction ID for optimistic confirmation
              applyDamageAndUpdateHealth(attackerId, targetId, damage, newHealth, 30, transactionId);
            }
          } else if (damageInfo.attackType === 'blocked') {
            // Show blocked attack feedback differently using combat store
            console.log(`🛡️ Processing blocked attack to ${targetId} (cooldown: ${damageInfo.remainingCooldown}ms)`);
            if (newHealth !== undefined) {
              // Apply blocked attack with special damage indicator
              // Include transaction ID for optimistic confirmation
              applyDamageAndUpdateHealth(attackerId, targetId, 'BLOCKED', newHealth, 30, transactionId);
            }
          }

          console.log(`💥 Combat Store: Applied ${damageInfo.attackType} attack - ${damage} damage from ${attackerId} to ${targetId}, new health: ${newHealth}`);
        }
      }

      // Handle optimistic attack verification failures
      if (messageObject.type === "optimisticAttackRejected") {
        const transactionId = messageObject.transactionId;
        const reason = messageObject.reason || "Server rejected attack";

        console.log(`❌ Optimistic attack rejected (txn: ${transactionId}) - ${reason}`);
        rollbackOptimisticDamage(transactionId, reason);
      }

      // Handle damage corrections from server validation
      if (messageObject.type === "damageCorrection") {
        const {
          attackerId,
          targetId,
          optimisticTransactionId,
          correctedDamage,
          correctedHealth,
          attackType,
          reason
        } = messageObject;

        console.log(`🔄 Damage correction received (txn: ${optimisticTransactionId}): ${reason}`);

        if (attackType === 'blocked' || attackType === 'error') {
          // Attack was invalid - rollback optimistic damage
          console.log(`❌ Rolling back invalid attack (txn: ${optimisticTransactionId}) - ${reason}`);
          rollbackOptimisticDamage(optimisticTransactionId, reason);
        } else {
          // Attack was valid but damage amount was different - apply correction
          console.log(`🔄 Correcting damage amount (txn: ${optimisticTransactionId}): ${correctedDamage} damage, health: ${correctedHealth}`);
          applyDamageAndUpdateHealth(attackerId, targetId, correctedDamage, correctedHealth, 30, optimisticTransactionId);
        }
      }

      if (messageObject.connections) {
        updateConnections(messageObject.connections);
        console.log("MY CID: ", messageObject.yourConnectionId);
        setUserConnectionId(messageObject.yourConnectionId);
      }
      // Handle harvest-related messages
      if (messageObject.harvestStarted) {
        startHarvest(
          messageObject.treeId,
          messageObject.playerId,
          messageObject.duration
        );
      }
      if (messageObject.harvestCompleted) {
        completeHarvest(messageObject.treeId);
        // Note: Berry addition is handled by backend and synced via inventory validation
        // Removing duplicate frontend addition to fix random berry quantities bug
      }

      // Handle inventory synchronization from backend
      if (messageObject.inventorySync || messageObject.inventoryValidation) {
        const inventory = messageObject.inventory;

        // Use new setInventory method for clean sync
        const { setInventory } = useInventoryStore.getState();
        setInventory(inventory);

        const messageType = messageObject.inventoryValidation ? 'validated' : 'synchronized';
        console.log(`Inventory ${messageType} with backend:`, inventory);

        // Mark inventory as validated
        markValidated();
      }

      // Handle harvest cancellation
      if (messageObject.harvestCancelled) {
        cancelHarvest(messageObject.treeId);
        console.log(`Harvest cancelled for tree ${messageObject.treeId} by player ${messageObject.playerId}`);
      }

      // Handle comprehensive game state validation
      if (messageObject.gameStateValidation) {
        const gameState = messageObject.gameState;
        console.log('Received game state validation:', gameState);

        // Sync inventory using new system
        const { setInventory } = useInventoryStore.getState();
        setInventory(gameState.inventory);

        // Sync harvest states
        const { activeHarvests, cancelHarvest, startHarvest } = useHarvestStore.getState();

        // Cancel harvests that don't exist on server
        Object.keys(activeHarvests).forEach(treeId => {
          const serverHasHarvest = gameState.activeHarvests.some(h => h.treeId === treeId);
          if (!serverHasHarvest) {
            console.log(`Cancelling client-side harvest for tree ${treeId} - not found on server`);
            cancelHarvest(treeId);
          }
        });

        // Start harvests that exist on server but not client
        gameState.activeHarvests.forEach(serverHarvest => {
          if (!activeHarvests[serverHarvest.treeId]) {
            const elapsedTime = Date.now() - serverHarvest.startTime;
            const remainingTime = Math.max(0, serverHarvest.duration - elapsedTime / 1000);
            if (remainingTime > 0) {
              console.log(`Starting client-side harvest for tree ${serverHarvest.treeId} - found on server`);
              startHarvest(serverHarvest.treeId, serverHarvest.playerId, remainingTime);
            }
          }
        });

        // Sync ground items
        if (gameState.groundItems) {
          console.log(`Syncing ${gameState.groundItems.length} ground items`);
          syncGroundItems(gameState.groundItems);
        }

        // Update health if different using combat store
        const { getPlayerHealth } = useCombatStore.getState();
        const currentHealth = getPlayerHealth(userConnectionId).current;
        if (currentHealth !== gameState.health) {
          console.log(`❤️ Backend sync - Own player health: ${currentHealth} -> ${gameState.health}`);
          setPlayerHealth(userConnectionId, gameState.health);
        }

        markValidated();

        // Notify loading store that game data is loaded
        setGameDataLoaded(true);

        console.log('Game state synchronized with backend');
      }

      // Handle death event
      if (messageObject.type === "playerDeath") {
        console.log("Player death event received:", messageObject);
        const deadPlayerId = messageObject.deadPlayerId;
        setDeathState(deadPlayerId, true, false);
        if (deadPlayerId === userConnectionId) {
          console.log("Current player has died");
        }
      }

      // Handle respawn event
      if (messageObject.type === "playerRespawn") {
        console.log("Player respawn event received:", messageObject);
        const playerId = messageObject.playerId;
        const health = messageObject.health;

        // Update health and death state atomically
        setPlayerHealth(playerId, health);
        setDeathState(playerId, false, true); // Not dead, but respawning

        console.log(`❤️ Respawn - Player ${playerId} health restored to: ${health}`);

        if (playerId === userConnectionId) {
          console.log("Current player is respawning");
        }

        // Reset respawning flag after a short delay
        setTimeout(() => {
          setDeathState(playerId, false, false); // Not dead, not respawning
        }, 1000);
      }

      // Handle berry consumption confirmation
      if (messageObject.berryConsumed) {
        console.log(`Berry consumed: ${messageObject.berryType}, health restored: ${messageObject.healthRestored}`);
        console.log(`❤️ Berry consumption - Own player health restored to: ${messageObject.newHealth}`);
        setPlayerHealth(userConnectionId, messageObject.newHealth);

        // Update inventory by requesting sync
        if (websocketConnection && websocketConnection.readyState === WebSocket.OPEN) {
          const payload = {
            chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4",
            action: "requestInventorySync",
          };
          websocketConnection.send(JSON.stringify(payload));
        }
      }

      // Handle inventory move acknowledgment
      if (messageObject.inventoryMoveAck) {
        console.log(`Inventory move acknowledged: slot ${messageObject.fromSlot} -> slot ${messageObject.toSlot}`);
        // The move was already applied locally for responsive UI
        // This acknowledgment confirms the backend processed it successfully
      }

      // Handle non-attack health updates (e.g., berry consumption, respawn)
      // Note: Attack damage health updates are now consolidated in the attack message above
      if (messageObject.playerHealthUpdate) {
        // Update health for all players using unified combat store
        const playerId = messageObject.playerId;
        const newHealth = messageObject.newHealth;

        console.log(`❤️ Backend update - Player ${playerId} health: ${newHealth}`);
        setPlayerHealth(playerId, newHealth);
      }
      // Handle ground item events
      if (messageObject.type === "groundItemCreated") {
        addGroundItemAndCleanup(messageObject.groundItem);
      }

      if (messageObject.type === "groundItemRemoved") {
        // Always remove the ground item from the list
        removeGroundItem(messageObject.groundItemId);

        // If this player picked up the item, confirm the pickup and sync inventory
        if (messageObject.pickedUpBy === userConnectionId) {
          console.log(`Pickup confirmed for item ${messageObject.groundItemId}, syncing inventory`);

          // Confirm pickup completed (removes from pending list)
          confirmPickupCompleted(messageObject.groundItemId);

          // Request inventory sync to update local inventory
          if (websocketConnection && websocketConnection.readyState === WebSocket.OPEN) {
            const payload = {
              chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4",
              action: "requestInventorySync",
            };
            websocketConnection.send(JSON.stringify(payload));
          }
        } else {
          // For other players' pickups, just confirm completion to clean up any pending state
          confirmPickupCompleted(messageObject.groundItemId);
        }
      }
    }
  };

  const _webSocketError = (e: Event) => {
    console.error("Websocket error:", e);
    console.error("WebSocket URL:", wsUrl);
    console.error("Error details:", {
      type: e.type,
      target: e.target,
      timeStamp: e.timeStamp
    });

    // Notify loading store that websocket is disconnected
    setWebsocketConnected(false);
    setGameDataLoaded(false);

    // Clear inventory on connection error to prevent stale state
    clearInventory();

    // Clear ground items on connection error
    clearGroundItems();

    // Cancel any active harvests on error
    const { activeHarvests, cancelHarvest } = useHarvestStore.getState();
    Object.keys(activeHarvests).forEach(treeId => {
      cancelHarvest(treeId);
    });
  };

  const _webSocketClose = (e: CloseEvent) => {
    console.log("Websocket close:", e);
    console.log("Close details:", {
      code: e.code,
      reason: e.reason,
      wasClean: e.wasClean
    });

    // Notify loading store that websocket is disconnected
    setWebsocketConnected(false);
    setGameDataLoaded(false);

    // Attempt to reconnect after 3 seconds
    setTimeout(() => {
      console.log("Attempting to reconnect WebSocket...");
      initializeWebSocket();
    }, 3000);
  };

  const _webSocketOpen = (e: Event) => {
    console.log("WebSocket connected successfully:", e);
    const ws = e.target as WebSocket; // Get the actual WebSocket instance

    // Notify loading store that websocket is connected
    setWebsocketConnected(true);

    // Connect to chat room once connection is established
    setTimeout(() => {
      connectToChatRoom("", ws);

      // Immediately request game state validation for faster loading
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log("🚀 Requesting immediate game state validation for faster loading");
          const gameStatePayload = {
            chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4",
            action: "validateGameState",
          };
          ws.send(JSON.stringify(gameStatePayload));

          // Also request inventory sync
          const inventoryPayload = {
            chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4",
            action: "requestInventorySync",
          };
          ws.send(JSON.stringify(inventoryPayload));
        }
      }, 100);
    }, 500); // Reduced to 500ms for faster connection
  };

  const initializeWebSocket = () => {
    try {
      console.log("Initializing WebSocket connection to:", wsUrl);
      const webSocketConnection = new WebSocket(wsUrl);

      webSocketConnection.onopen = _webSocketOpen;
      webSocketConnection.onerror = _webSocketError;
      webSocketConnection.onclose = _webSocketClose;
      webSocketConnection.onmessage = _webSocketMessageReceived;

      setWebSocket(webSocketConnection);
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  };

  //Initialize Websocket
  useEffect(() => {
    initializeWebSocket();
  }, []);

  // Periodic game state validation
  useEffect(() => {
    const validationInterval = setInterval(() => {
      if (websocketConnection && websocketConnection.readyState === WebSocket.OPEN && shouldValidate()) {
        const payload = {
          chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4",
          action: "validateGameState",
        };
        websocketConnection.send(JSON.stringify(payload));
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(validationInterval);
  }, [websocketConnection, shouldValidate]);

  return <div> </div>;
};

export default Api;
