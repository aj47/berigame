const uuid = require("uuid");
const AWS = require("aws-sdk");
const jwt = require("jsonwebtoken");
const helpers = require("./helpers");
const { getRounds } = require("bcryptjs");
const { validCallbackObject } = require("./helpers");
const PositionValidator = require("./positionValidator");
const {
  getPlayerInventory,
  addItemToInventory,
  removeItemFromInventory,
  playerHasItem,
  getPlayerItemCount,
  createInventoryUpdateExpression,
  consumeItem,
  createGroundItemData,
  groundItemToInventoryItem,
  getInventorySyncData
} = require("./inventoryHelper");
const apig = new AWS.ApiGatewayManagementApi({
  //Offline check for websocket issue with serverless offline
  //https://github.com/dherault/serverless-offline/issues/924
  endpoint: process.env.IS_OFFLINE
    ? `http://localhost:3001`
    : process.env.APIG_ENDPOINT,
});
const dynamodb = new AWS.DynamoDB.DocumentClient();

// DynamoDB timing utility
const logDynamoDBCall = (operation, params) => {
  const startTime = Date.now();
  const operationId = `${operation}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Only log start for slow operations or when debugging
  // console.log(`🔵 [${operationId}] Starting DynamoDB ${operation}`);

  return {
    operationId,
    startTime,
    finish: () => {
      const duration = Date.now() - startTime;
      // Only log slow operations to reduce noise
      if (duration > 500) {
        console.warn(`🐌 [${operationId}] Slow DynamoDB ${operation}: ${duration}ms`);
      }

      return duration;
    }
  };
};

const DB = process.env.DB;
const positionValidator = new PositionValidator(DB);

// Attack cooldown system - server-side with 1-second rate limiting
const ATTACK_COOLDOWN_MS = 1000; // 1 second rate limiting per player

/**
 * Check if player can attack based on database-stored last attack time
 * @param {string} connectionId - Player's connection ID
 * @param {string} chatRoomId - Chat room ID
 * @returns {Promise<{canAttack: boolean, cooldownRemaining: number, lastAttackTime: number}>}
 */
const checkPlayerAttackCooldown = async (connectionId, chatRoomId) => {
  const playerParams = {
    TableName: process.env.DB,
    Key: {
      PK: chatRoomId,
      SK: "CONNECTION#" + connectionId,
    },
    ProjectionExpression: "lastAttackTime"
  };

  try {
    const cooldownTimer = logDynamoDBCall('get', playerParams);
    const playerData = await dynamodb.get(playerParams).promise();
    cooldownTimer.finish();

    const lastAttackTime = playerData.Item?.lastAttackTime || 0;
    const currentTime = Date.now();
    const timeSinceLastAttack = currentTime - lastAttackTime;
    const canAttack = timeSinceLastAttack >= ATTACK_COOLDOWN_MS;
    const cooldownRemaining = canAttack ? 0 : ATTACK_COOLDOWN_MS - timeSinceLastAttack;

    return {
      canAttack,
      cooldownRemaining,
      lastAttackTime
    };
  } catch (error) {
    console.error(`Error checking attack cooldown for ${connectionId}:`, error);
    // On error, allow attack but log the issue
    return {
      canAttack: true,
      cooldownRemaining: 0,
      lastAttackTime: 0
    };
  }
};

/**
 * Update player's last attack time in database
 * @param {string} connectionId - Player's connection ID
 * @param {string} chatRoomId - Chat room ID
 * @param {number} attackTime - Timestamp of the attack
 */
const updatePlayerAttackTime = async (connectionId, chatRoomId, attackTime) => {
  const updateParams = {
    TableName: process.env.DB,
    Key: {
      PK: chatRoomId,
      SK: "CONNECTION#" + connectionId,
    },
    UpdateExpression: "SET lastAttackTime = :attackTime",
    ExpressionAttributeValues: {
      ":attackTime": attackTime
    }
  };

  try {
    const attackTimer = logDynamoDBCall('update', updateParams);
    await dynamodb.update(updateParams).promise();
    attackTimer.finish();
  } catch (error) {
    console.error(`Error updating attack time for ${connectionId}:`, error);
  }
};

// Log levels: ERROR = 0, WARN = 1, INFO = 2, DEBUG = 3
const LOG_LEVEL = parseInt(process.env.LOG_LEVEL) || 1; // Default to WARN level

const logger = {
  error: (message, ...args) => {
    if (LOG_LEVEL >= 0) console.error(message, ...args);
  },
  warn: (message, ...args) => {
    if (LOG_LEVEL >= 1) console.warn(message, ...args);
  },
  info: (message, ...args) => {
    if (LOG_LEVEL >= 2) console.log(message, ...args);
  },
  debug: (message, ...args) => {
    if (LOG_LEVEL >= 3) console.log(message, ...args);
  }
};

// Connection caching to reduce DynamoDB queries
const connectionCache = new Map();
const staleConnections = new Set(); // Track connections that returned 410 errors
const CACHE_TTL = 30000; // 30 seconds cache TTL
const CACHE_CLEANUP_INTERVAL = 60000; // Clean up every minute

// Clean up expired cache entries and stale connections
setInterval(() => {
  const now = Date.now();
  let cleanedCacheCount = 0;
  let staleConnectionsCount = staleConnections.size;

  // Clean expired cache entries
  for (const [key, value] of connectionCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      connectionCache.delete(key);
      cleanedCacheCount++;
    }
  }

  // Clear stale connections set periodically to allow retry of connections
  // that might have reconnected (every 5 minutes)
  if (now % (5 * 60 * 1000) < CACHE_CLEANUP_INTERVAL) {
    staleConnections.clear();
    if (staleConnectionsCount > 0) {
      logger.debug(`🧹 Cleared ${staleConnectionsCount} stale connection entries for retry`);
    }
  }

  if (cleanedCacheCount > 0) {
    logger.debug(`🧹 Cleaned ${cleanedCacheCount} expired cache entries`);
  }
}, CACHE_CLEANUP_INTERVAL);

/**
 * Get connections with caching to reduce DynamoDB queries
 * @param {string} chatRoomId - The chat room ID
 * @param {boolean} forceRefresh - Force refresh cache
 * @returns {Promise<Array>} Array of connection items
 */
async function getCachedConnections(chatRoomId, forceRefresh = false) {
  const cacheKey = `connections_${chatRoomId}`;
  const now = Date.now();

  // Check cache first
  if (!forceRefresh && connectionCache.has(cacheKey)) {
    const cached = connectionCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL) {
      performanceMetrics.cacheHits++;
      logger.debug(`💾 Cache hit for ${chatRoomId} (${cached.connections.length} connections)`);
      return cached.connections;
    }
  }

  // Cache miss - query DynamoDB
  performanceMetrics.cacheMisses++;
  const queryStartTime = Date.now();
  logger.debug(`🔍 Querying DynamoDB for connections in ${chatRoomId}...`);

  const usersParams = {
    TableName: DB,
    KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
    ExpressionAttributeValues: {
      ":pk": chatRoomId,
      ":sk": "CONNECTION#",
    },
  };

  const timer = logDynamoDBCall('query', usersParams);
  const result = await dynamodb.query(usersParams).promise();
  timer.finish();
  const queryTime = Date.now() - queryStartTime;

  logger.debug(`📊 DynamoDB query completed in ${queryTime}ms (${result.Items.length} connections found)`);

  if (queryTime > 200) {
    logger.warn(`🐌 Slow DynamoDB query: ${queryTime}ms for connections in ${chatRoomId}`);
  }

  // Cache the result
  connectionCache.set(cacheKey, {
    connections: result.Items,
    timestamp: now
  });

  return result.Items;
}

/**
 * Performance monitoring for broadcasting
 */
const performanceMetrics = {
  totalBroadcasts: 0,
  totalBroadcastTime: 0,
  averageBroadcastTime: 0,
  slowBroadcasts: 0,
  failedConnections: 0,
  cacheHits: 0,
  cacheMisses: 0
};

/**
 * Log performance metrics periodically - only when there's significant activity
 */
setInterval(() => {
  const hasSignificantActivity = performanceMetrics.totalBroadcasts > 5 ||
                                 performanceMetrics.failedConnections > 10 ||
                                 performanceMetrics.slowBroadcasts > 0;

  if (hasSignificantActivity) {
    const cacheHitRate = performanceMetrics.cacheHits + performanceMetrics.cacheMisses > 0
      ? Math.round((performanceMetrics.cacheHits / (performanceMetrics.cacheHits + performanceMetrics.cacheMisses)) * 100)
      : 0;

    const failureRate = performanceMetrics.totalBroadcasts > 0
      ? Math.round((performanceMetrics.failedConnections / performanceMetrics.totalBroadcasts) * 100)
      : 0;

    logger.info('📊 Broadcasting Performance (1min):', {
      broadcasts: performanceMetrics.totalBroadcasts,
      avgTime: Math.round(performanceMetrics.averageBroadcastTime) + 'ms',
      slowBroadcasts: performanceMetrics.slowBroadcasts,
      failedConnections: performanceMetrics.failedConnections,
      failureRate: failureRate + '%',
      cacheHitRate: cacheHitRate + '%',
      staleConnectionsTracked: staleConnections.size
    });

    // Reset metrics after logging
    Object.keys(performanceMetrics).forEach(key => performanceMetrics[key] = 0);
  } else if (performanceMetrics.totalBroadcasts > 0) {
    // Just reset metrics without logging for low activity periods
    Object.keys(performanceMetrics).forEach(key => performanceMetrics[key] = 0);
  }
}, 60000); // Log every minute

/**
 * Broadcast message to all connections in parallel with performance monitoring
 * @param {Array} connections - Array of connection items
 * @param {Object} message - Message to broadcast
 * @param {string} excludeConnectionId - Connection ID to exclude from broadcast
 */
async function broadcastToConnections(connections, message, excludeConnectionId = null) {
  const startTime = Date.now();
  let failedCount = 0;
  let staleConnectionCount = 0;

  // Filter out known stale connections and excluded connections
  const activeConnections = connections.filter(connection => {
    const targetConnectionId = connection.SK.split("#")[1];
    if (excludeConnectionId && targetConnectionId === excludeConnectionId) {
      return false;
    }
    if (staleConnections.has(targetConnectionId)) {
      return false;
    }
    return true;
  });

  logger.debug(`📡 Broadcasting to ${activeConnections.length}/${connections.length} connections (excluding ${excludeConnectionId || 'none'})`);

  const broadcastPromises = activeConnections.map(async (connection) => {
    const targetConnectionId = connection.SK.split("#")[1];

    const individualStartTime = Date.now();
    try {
      await apig.postToConnection({
        ConnectionId: targetConnectionId,
        Data: JSON.stringify(message),
      }).promise();

      const individualTime = Date.now() - individualStartTime;
      if (individualTime > 100) {
        logger.debug(`  ✅ Sent to ${targetConnectionId} in ${individualTime}ms`);
      }

    } catch (e) {
      failedCount++;
      const individualTime = Date.now() - individualStartTime;

      // If connection is stale, track it and remove from cache
      if (e.statusCode === 410) {
        staleConnections.add(targetConnectionId);
        staleConnectionCount++;
        const cacheKey = `connections_${message.chatRoomId || 'unknown'}`;
        connectionCache.delete(cacheKey);
        logger.debug(`  💀 Connection ${targetConnectionId} is stale (410)`);

        // Proactively clean up stale connection from database
        cleanupStaleConnectionFromDB(message.chatRoomId, targetConnectionId);
      } else {
        logger.warn(`  ❌ Failed to send to ${targetConnectionId} in ${individualTime}ms: ${e.statusCode}`);
      }
    }
  });

  // Wait for all broadcasts to complete
  const settledResults = await Promise.allSettled(broadcastPromises);

  // Update performance metrics
  const broadcastTime = Date.now() - startTime;
  performanceMetrics.totalBroadcasts++;
  performanceMetrics.totalBroadcastTime += broadcastTime;
  performanceMetrics.averageBroadcastTime = performanceMetrics.totalBroadcastTime / performanceMetrics.totalBroadcasts;
  performanceMetrics.failedConnections += failedCount;

  // Only log broadcast results if there are issues or it's slow
  if (failedCount > 0 || broadcastTime > 500) {
    logger.info(`📤 Broadcast completed: ${broadcastTime}ms total, ${failedCount} failures (${staleConnectionCount} stale), ${settledResults.length} attempts`);
  } else {
    logger.debug(`📤 Broadcast completed: ${broadcastTime}ms total, ${settledResults.length} successful`);
  }

  if (broadcastTime > 1000) {
    performanceMetrics.slowBroadcasts++;
    logger.warn(`🐌 Slow broadcast detected: ${broadcastTime}ms for ${connections.length} connections`);
  }
}

/**
 * Proactively clean up a stale connection from the database
 * This runs asynchronously and doesn't block the broadcast
 */
async function cleanupStaleConnectionFromDB(chatRoomId, connectionId) {
  try {
    const deleteParams = {
      TableName: DB,
      Key: {
        PK: chatRoomId,
        SK: "CONNECTION#" + connectionId,
      },
    };
    const cleanupTimer = logDynamoDBCall('delete', deleteParams);
    await dynamodb.delete(deleteParams).promise();
    cleanupTimer.finish();

    logger.debug(`🗑️ Proactively cleaned up stale connection ${connectionId} from ${chatRoomId}`);
  } catch (error) {
    // Don't log errors for cleanup failures as they're not critical
    logger.debug(`Failed to cleanup stale connection ${connectionId}:`, error.message);
  }
}

exports.handler = async function (event, context) {
  const handlerStartTime = Date.now();
  const {
    body,
    requestContext: { connectionId, routeKey, identity },
  } = event;
  const timestamp = new Date().getTime();
  let userPK = null,
    bodyAsJSON = null,
    PK = null,
    SK = null,
    senderId = null;
  if (body) {
    bodyAsJSON = JSON.parse(body);
    // userPK = jwt.decode(bodyAsJSON.token, process.env.JWT_SECRET).PK;
    senderId = connectionId;
  }

  // Debug timing for delay analysis
  const debugTiming = {
    handlerStart: handlerStartTime,
    routeKey: routeKey,
    connectionId: connectionId,
    bodySize: body ? body.length : 0
  };
  // Default spawn location - center of the island
  const SPAWN_LOCATION = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }
  };

  const MAX_HEALTH = 30;

  const handlePlayerDeath = async (connectionId, chatRoomId) => {
    try {
      // 1. Get player's current inventory before death
      const playerParams = {
        TableName: process.env.DB,
        Key: {
          PK: chatRoomId,
          SK: "CONNECTION#" + connectionId,
        },
      };

      const deathPlayerTimer = logDynamoDBCall('get', playerParams);
      const playerData = await dynamodb.get(playerParams).promise();
      deathPlayerTimer.finish();

      if (playerData.Item) {
        const player = playerData.Item;
        const deathPosition = player.lastValidPosition || SPAWN_LOCATION.position;

        // Drop all inventory items at death location using new inventory system
        const inventory = getPlayerInventory(player);
        const droppedItems = [];

        // Get all non-empty slots and drop their contents
        const slots = inventory.getSlots();
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (!slot.isEmpty()) {
            const item = slot.getItem();

            // Create ground item data
            const scatterPosition = {
              x: deathPosition.x + (Math.random() - 0.5) * 2, // Scatter items slightly
              y: deathPosition.y,
              z: deathPosition.z + (Math.random() - 0.5) * 2,
            };

            const groundItemId = `GROUND_ITEM#${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            const groundItemData = createGroundItemData(
              item.itemId,
              item.quantity,
              scatterPosition,
              connectionId,
              item.metadata
            );

            // Add death flag and save to database
            groundItemData.droppedOnDeath = true;
            const deathItemParams = {
              TableName: process.env.DB,
              Item: {
                PK: chatRoomId,
                SK: groundItemId,
                ...groundItemData,
              },
            };
            const deathItemTimer = logDynamoDBCall('put', deathItemParams);
            await dynamodb.put(deathItemParams).promise();
            deathItemTimer.finish();

            droppedItems.push({
              id: groundItemId,
              ...groundItemData,
            });
          }
        }

      // Reset player's inventory and health/position using new inventory system
      const respawnParams = {
        TableName: process.env.DB,
        Key: {
          PK: chatRoomId,
          SK: "CONNECTION#" + connectionId,
        },
        UpdateExpression: "SET health = :health, #pos = :position, #rot = :rotation, inventory = :emptyInventory, lastValidPosition = :lastValidPosition, lastPositionUpdate = :timestamp",
        ExpressionAttributeNames: {
          "#pos": "position",
          "#rot": "rotation"
        },
        ExpressionAttributeValues: {
          ":health": MAX_HEALTH,
          ":position": SPAWN_LOCATION.position,
          ":rotation": SPAWN_LOCATION.rotation,
          ":emptyInventory": [], // Empty slot-based inventory
          ":lastValidPosition": SPAWN_LOCATION.position, // Critical: Update position validator's reference
          ":timestamp": Date.now(), // Update position timestamp for validator
        },
      };

      // 1. Respawn the player
      const respawnTimer = logDynamoDBCall('update', respawnParams);
      await dynamodb.update(respawnParams).promise();
      respawnTimer.finish();
      logger.info(`Player ${connectionId} respawned successfully, dropped ${droppedItems.length} item stacks`);

      // 2. Get all connections to broadcast death/respawn event
      const connections = await getCachedConnections(chatRoomId);

      // 3. Broadcast death/respawn event and dropped items to all connected players
      const deathMessage = {
        type: "playerDeath",
        deadPlayerId: connectionId,
        respawnLocation: SPAWN_LOCATION,
        droppedItems: droppedItems,
        timestamp: Date.now(),
        chatRoomId: chatRoomId,
      };

      const respawnMessage = {
        type: "playerRespawn",
        playerId: connectionId,
        health: MAX_HEALTH,
        position: SPAWN_LOCATION.position,
        rotation: SPAWN_LOCATION.rotation,
        timestamp: Date.now(),
        chatRoomId: chatRoomId,
      };

      // Broadcast death and respawn events in parallel
      await Promise.all([
        broadcastToConnections(connections, deathMessage),
        broadcastToConnections(connections, respawnMessage)
      ]);

      // Broadcast ground item creation events for each dropped item
      const groundItemPromises = droppedItems.map(droppedItem =>
        broadcastToConnections(connections, {
          type: "groundItemCreated",
          groundItem: droppedItem,
          timestamp: Date.now(),
          chatRoomId: chatRoomId,
        })
      );

      await Promise.all(groundItemPromises);
      }

    } catch (error) {
      console.error(`Error handling player death for ${connectionId}:`, error);
    }
  };

  const dealDamage = async (connectionId, damage, chatRoomId) => {
    const rowParams = {
      TableName: process.env.DB,
      Key: {
        PK: chatRoomId,
        SK: "CONNECTION#" + connectionId,
      },
      UpdateExpression: "SET health = health - :val",
      ExpressionAttributeValues: {
        ":val": damage,
      },
      ReturnValues: "ALL_NEW"
    };

    try {
      const timer = logDynamoDBCall('update', rowParams);
      const updateResult = await dynamodb.update(rowParams).promise();
      timer.finish();
      const newHealth = updateResult.Attributes.health;

      console.log(`Player ${connectionId} took ${damage} damage, new health: ${newHealth}`);

      // Check for death after dealing damage
      if (newHealth <= 0) {
        await handlePlayerDeath(connectionId, chatRoomId);
      }

      // Return the new health value instead of broadcasting separately
      return newHealth;
    } catch (e) {
      console.error(
        "Unable to update item. Error JSON:",
        JSON.stringify(e, null, 2)
      );
    }
  };

  // Store for optimistic damage values to ensure consistency between optimistic and validated damage
  const optimisticDamageStore = new Map();

  /**
   * Generate damage value and store it for later validation
   * This ensures the same damage value is used for both optimistic and validated phases
   */
  const generateAndStoreDamage = (transactionId) => {
    // Generate damage (0-3)
    const damage = Math.floor(Math.random() * 4);

    // Store with TTL to prevent memory leaks (cleanup after 30 seconds)
    optimisticDamageStore.set(transactionId, {
      damage,
      timestamp: Date.now()
    });

    // Schedule cleanup after 30 seconds
    setTimeout(() => {
      optimisticDamageStore.delete(transactionId);
    }, 30000);

    return damage;
  };

  /**
   * Get stored damage value for validation, or generate new one if not found
   */
  const getStoredDamage = (transactionId) => {
    const stored = optimisticDamageStore.get(transactionId);
    if (stored) {
      // Clean up after retrieval since we only need it once
      optimisticDamageStore.delete(transactionId);
      return stored.damage;
    }
    // Fallback: generate new damage if not found (shouldn't happen in normal flow)
    return Math.floor(Math.random() * 4);
  };

  /**
   * Validate attack using pre-generated damage value
   * Returns validation result with the same damage used in optimistic broadcast
   */
  const validateAttackAndCalculateDamage = async (attackerId, targetId, chatRoomId, optimisticTransactionId) => {
    try {
      const currentTime = Date.now();

      // Check attack cooldown from database
      const cooldownCheck = await checkPlayerAttackCooldown(attackerId, chatRoomId);

      if (cooldownCheck.canAttack) {
        // Use the same damage value that was broadcast optimistically
        const actualDamage = getStoredDamage(optimisticTransactionId);

        // Update attack time in database
        await updatePlayerAttackTime(attackerId, chatRoomId, currentTime);

        return {
          valid: true,
          damage: actualDamage,
          cooldownRemaining: 0,
          attackType: 'hit',
          reason: null
        };
      } else {
        // Clean up stored damage since attack is invalid
        optimisticDamageStore.delete(optimisticTransactionId);

        return {
          valid: false,
          damage: 0,
          cooldownRemaining: cooldownCheck.cooldownRemaining,
          attackType: 'blocked',
          reason: `Attack blocked - cooldown remaining: ${cooldownCheck.cooldownRemaining}ms`
        };
      }
    } catch (error) {
      console.error(`Error validating attack from ${attackerId} to ${targetId}:`, error);
      // Clean up stored damage on error
      optimisticDamageStore.delete(optimisticTransactionId);

      return {
        valid: false,
        damage: 0,
        cooldownRemaining: 0,
        attackType: 'error',
        reason: 'Server error during validation'
      };
    }
  };

  /**
   * Send correction message to all players when validation differs from optimistic broadcast
   */
  const sendDamageCorrection = async (attackerId, targetId, chatRoomId, optimisticTransactionId, correctionData) => {
    try {
      const connections = await getCachedConnections(chatRoomId);

      const correctionMessage = {
        type: "damageCorrection",
        attackerId,
        targetId,
        optimisticTransactionId,
        correctedDamage: correctionData.actualDamage,
        correctedHealth: correctionData.actualHealth,
        attackType: correctionData.attackType,
        reason: correctionData.reason,
        timestamp: Date.now(),
        chatRoomId
      };

      console.log(`🔄 Sending damage correction for txn ${optimisticTransactionId}: ${correctionData.reason}`);
      await broadcastToConnections(connections, correctionMessage);
    } catch (error) {
      console.error(`Failed to send damage correction for txn ${optimisticTransactionId}:`, error);
    }
  };

  switch (routeKey) {
    case "$connect":
      break;

    case "$disconnect":
      try {
        // Clean up user data when they disconnect
        logger.info(`🔌 User ${connectionId} disconnecting, cleaning up...`);

        // Remove from stale connections set if present
        staleConnections.delete(connectionId);

        // Find all chat rooms this connection was part of and clean up
        const scanParams = {
          TableName: DB,
          FilterExpression: "SK = :sk",
          ExpressionAttributeValues: {
            ":sk": "CONNECTION#" + connectionId,
          },
        };

        const disconnectScanTimer = logDynamoDBCall('scan', scanParams);
        const scanResult = await dynamodb.scan(scanParams).promise();
        disconnectScanTimer.finish();

        for (const item of scanResult.Items) {
          const chatRoomId = item.PK;

          // Delete the connection record
          const disconnectDeleteParams = {
            TableName: DB,
            Key: {
              PK: chatRoomId,
              SK: "CONNECTION#" + connectionId,
            },
          };
          const disconnectDeleteTimer = logDynamoDBCall('delete', disconnectDeleteParams);
          await dynamodb.delete(disconnectDeleteParams).promise();
          disconnectDeleteTimer.finish();

          // Clear cache for this chat room to force refresh
          const cacheKey = `connections_${chatRoomId}`;
          connectionCache.delete(cacheKey);

          logger.debug(`🧹 Cleaned up connection ${connectionId} from ${chatRoomId}`);
        }

        logger.info(`✅ Cleanup completed for ${connectionId} (${scanResult.Items.length} rooms)`);
      } catch (e) {
        logger.error("Error during disconnect cleanup:", e);
      }
      break;

    // const samplePayload = {
    //   "action": "connectToChatRoom",
    //   "chatRoomId": "CHATROOM#123"
    //   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJQSyI6IlVTRVIjZmNjMmNjNTAtZGNiOC0xMWViLWJjOWItZTFkNmIwNmI3ZGIzIiwiaWF0IjoxNjI1NjY0MjEwfQ.CI8C_oZpDfIETQOHktt4HkIlBEhn_2jy7dLwd0b0zPM"
    // }
    case "connectToChatRoom":
      SK = "CONNECTION#" + connectionId;
      PK = bodyAsJSON.chatRoomId; //TODO: Auth check
      const putParams = {
        TableName: DB,
        Item: {
          PK,
          SK,
          created: timestamp,
          ttl: Math.floor(new Date().getTime() / 1000) + 120, // 2 mins from now
          health: MAX_HEALTH,
          inventory: [], // Initialize empty slot-based inventory
          // Position validation fields
          lastValidPosition: SPAWN_LOCATION.position,
          lastPositionUpdate: timestamp,
          // Attack cooldown tracking
          lastAttackTime: 0, // Initialize to allow immediate first attack
          violationCount: 0,
          lastViolationTime: 0,
          updateCount: 0,
        },
      };
      const timer = logDynamoDBCall('put', putParams);
      await dynamodb.put(putParams).promise();
      timer.finish();
      //Get all connectionIDs associated with chatroom to send back to user
      const getConnections = await getCachedConnections(bodyAsJSON.chatRoomId, true); // Force refresh on connect
      try {
        await apig
          .postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({
              yourConnectionId: senderId,
              connections: getConnections,
            }),
          })
          .promise();
      } catch (e) {
        // Silently handle connection errors
      }

      // Send inventory state to the connecting player
      const playerConnection = getConnections.find(
        conn => conn.SK === "CONNECTION#" + connectionId
      );

      if (playerConnection) {
        // Get inventory sync data
        const inventoryData = getInventorySyncData(playerConnection);

        try {
          await apig
            .postToConnection({
              ConnectionId: connectionId,
              Data: JSON.stringify({
                inventorySync: true,
                inventory: inventoryData,
                timestamp: Date.now(),
              }),
            })
            .promise();
        } catch (e) {
          // Silently handle connection errors
        }
      }
      break;

    // const samplePayload = {
    //   "message": "yo whats up?",
    //   "action": "sendMessagePublic",
    //   "chatRoomId": "CHATROOM#1234567",
    //   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJQSyI6IlVTRVIjZmNjMmNjNTAtZGNiOC0xMWViLWJjOWItZTFkNmIwNmI3ZGIzIiwiaWF0IjoxNjI1NjY0MjEwfQ.CI8C_oZpDfIETQOHktt4HkIlBEhn_2jy7dLwd0b0zPM"
    // }
    case "sendMessagePublic":
      try {
        //Get all connectionIDs associated with chatroom
        const connections = await getCachedConnections(bodyAsJSON.chatRoomId);

        //Send message to socket connections in parallel
        const message = {
          message: bodyAsJSON.message,
          senderId,
          chatMessage: true,
          timestamp: Date.now(),
          chatRoomId: bodyAsJSON.chatRoomId,
        };

        await broadcastToConnections(connections, message);
      } catch (e) {
        logger.error("sendMessagePublic error:", e);
      }
      break;

    case "sendUpdate": //TODO: rename to send update
      try {
        const caseStartTime = Date.now();
        const currentTimestamp = Date.now();
        const incomingPosition = bodyAsJSON.message.position;

        // Focus on attack timing only
        // console.log(`🔍 [${connectionId}] SendUpdate started at ${caseStartTime}`);

        // Validate position update
        const validationStartTime = Date.now();
        const validationResult = await positionValidator.validatePositionUpdate(
          connectionId,
          bodyAsJSON.chatRoomId,
          incomingPosition,
          currentTimestamp
        );
        const validationTime = Date.now() - validationStartTime;
        if (validationTime > 50) {
          logger.debug(`⚡ [${connectionId}] Position validation took ${validationTime}ms`);
        }

        // If position is invalid, send correction back to the client
        if (!validationResult.valid) {
          logger.warn(`❌ [${connectionId}] Position validation failed: ${validationResult.reason}`);
          // Send position correction to the offending client
          try {
            await apig
              .postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                  type: "positionCorrection",
                  correctedPosition: validationResult.correctedPosition,
                  reason: validationResult.reason,
                  timestamp: currentTimestamp
                }),
              })
              .promise();
          } catch (e) {
            // Silently handle connection errors
          }

          // Don't broadcast invalid position to other players
          return { statusCode: 200 };
        }

        // Use the validated/corrected position for broadcasting
        bodyAsJSON.message.position = validationResult.correctedPosition;
        bodyAsJSON.message.serverValidated = true;
        bodyAsJSON.message.validationTimestamp = currentTimestamp;

        // OPTIMISTIC DAMAGE BROADCASTING - Broadcast immediately, validate later
        const attackingPlayer = bodyAsJSON.message.attackingPlayer;
        const optimisticTransactionId = bodyAsJSON.message.optimisticTransactionId;

        if (attackingPlayer) {
          const currentTime = Date.now();

          // Generate and store damage for consistent optimistic/validated flow
          const estimatedDamage = generateAndStoreDamage(optimisticTransactionId);

          console.log(`⚡ [${currentTime}] OPTIMISTIC: ${connectionId} → ${attackingPlayer}: ${estimatedDamage} damage (stored for validation) ${optimisticTransactionId ? `(txn: ${optimisticTransactionId})` : ''}`);

          // Add optimistic damage to message for immediate broadcast
          bodyAsJSON.message.damageGiven = {
            receivingPlayer: attackingPlayer,
            damage: estimatedDamage,
            cooldownRemaining: 0, // Optimistic assumption
            attackAllowed: true, // Optimistic assumption
            attackType: 'hit', // Optimistic assumption
            optimisticTransactionId: optimisticTransactionId,
            isOptimistic: true // Flag to indicate this is unvalidated
          };

          // Estimate new health for immediate broadcast (assuming 30 max health)
          // This will be corrected later if needed
          if (estimatedDamage > 0) {
            // We don't have the current health here, so we'll let the frontend handle the optimistic health update
            // The correction will come later with the actual health
            bodyAsJSON.message.damageGiven.estimatedHealthReduction = estimatedDamage;
          }
        }

        // Broadcast validated position to other players in parallel
        const broadcastStartTime = Date.now();
        bodyAsJSON.message.connectionId = connectionId;
        bodyAsJSON.message.userId = senderId;
        bodyAsJSON.message.chatRoomId = bodyAsJSON.chatRoomId;

        // Create connection objects from connection IDs for broadcasting
        const connectionObjects = bodyAsJSON.connections.map(connId => ({
          SK: `CONNECTION#${connId}`
        }));

        logger.debug(`📡 [${connectionId}] Broadcasting to ${connectionObjects.length} connections...`);
        // Don't exclude the attacker from receiving attack messages - they need to see damage numbers
        await broadcastToConnections(connectionObjects, bodyAsJSON.message);

        const broadcastTime = Date.now() - broadcastStartTime;

        // BACKGROUND VALIDATION - Validate attack after broadcasting
        if (attackingPlayer && optimisticTransactionId) {
          // Run validation in background (don't await to avoid blocking)
          setImmediate(async () => {
            try {
              const validationStartTime = Date.now();

              // Validate the attack and get actual damage
              const validationResult = await validateAttackAndCalculateDamage(
                connectionId,
                attackingPlayer,
                bodyAsJSON.chatRoomId,
                optimisticTransactionId
              );

              const estimatedDamage = bodyAsJSON.message.damageGiven.damage;
              const actualDamage = validationResult.damage;
              let actualHealth = null;

              // Apply actual damage if attack is valid
              if (validationResult.valid && actualDamage > 0) {
                actualHealth = await dealDamage(attackingPlayer, actualDamage, bodyAsJSON.chatRoomId);
              }

              const validationTime = Date.now() - validationStartTime;

              // Check if correction is needed
              const needsCorrection = !validationResult.valid ||
                                    estimatedDamage !== actualDamage ||
                                    validationResult.attackType !== 'hit';

              if (needsCorrection) {
                console.log(`🔄 [${Date.now()}] CORRECTION NEEDED for txn ${optimisticTransactionId}: estimated=${estimatedDamage}, actual=${actualDamage}, valid=${validationResult.valid}`);

                // Send correction to all players
                await sendDamageCorrection(
                  connectionId,
                  attackingPlayer,
                  bodyAsJSON.chatRoomId,
                  optimisticTransactionId,
                  {
                    actualDamage,
                    actualHealth,
                    attackType: validationResult.attackType,
                    reason: validationResult.reason || `Damage corrected from ${estimatedDamage} to ${actualDamage}`
                  }
                );
              } else {
                console.log(`✅ [${Date.now()}] VALIDATION CONFIRMED for txn ${optimisticTransactionId}: ${actualDamage} damage (${validationTime}ms)`);
              }

            } catch (error) {
              console.error(`❌ Background validation failed for txn ${optimisticTransactionId}:`, error);

              // Send error correction
              await sendDamageCorrection(
                connectionId,
                attackingPlayer,
                bodyAsJSON.chatRoomId,
                optimisticTransactionId,
                {
                  actualDamage: 0,
                  actualHealth: null,
                  attackType: 'error',
                  reason: 'Server validation error'
                }
              );
            }
          });
        }

        const totalTime = Date.now() - caseStartTime;

        if (broadcastTime > 100 || totalTime > 200) {
          logger.debug(`📤 [${connectionId}] Broadcast completed in ${broadcastTime}ms`);
          logger.debug(`🏁 [${connectionId}] Total sendUpdate time: ${totalTime}ms (validation: ${validationTime}ms, broadcast: ${broadcastTime}ms)`);
        }

      } catch (e) {
        logger.error("SendUpdate error:", e);
      }
      break;

    case "startHarvest":
      try {
        const treeId = bodyAsJSON.treeId;
        const berryType = bodyAsJSON.berryType || 'blueberry';
        const harvestDuration = Math.floor(Math.random() * 8) + 3; // 3-10 seconds

        // Store harvest start time in database
        const harvestPutParams = {
          TableName: DB,
          Item: {
            PK: bodyAsJSON.chatRoomId,
            SK: `HARVEST#${treeId}#${connectionId}`,
            treeId,
            berryType,
            playerId: connectionId,
            startTime: timestamp,
            duration: harvestDuration,
            ttl: Math.floor(new Date().getTime() / 1000) + 600, // 10 mins from now
          },
        };
        const harvestTimer = logDynamoDBCall('put', harvestPutParams);
        await dynamodb.put(harvestPutParams).promise();
        harvestTimer.finish();

        // Get all connections to broadcast harvest start
        const connections = await getCachedConnections(bodyAsJSON.chatRoomId);

        // Broadcast harvest started to all players in parallel
        const harvestStartMessage = {
          harvestStarted: true,
          treeId,
          berryType,
          playerId: connectionId,
          duration: harvestDuration,
          timestamp: Date.now(),
          chatRoomId: bodyAsJSON.chatRoomId,
        };

        await broadcastToConnections(connections, harvestStartMessage);

        // Schedule harvest completion
        setTimeout(async () => {
          try {
            // Check if harvest is still active (not cancelled)
            const harvestCheckParams = {
              TableName: DB,
              Key: {
                PK: bodyAsJSON.chatRoomId,
                SK: `HARVEST#${treeId}#${connectionId}`,
              },
            };
            const harvestCheckTimer = logDynamoDBCall('get', harvestCheckParams);
            const harvestCheck = await dynamodb.get(harvestCheckParams).promise();
            harvestCheckTimer.finish();

            if (harvestCheck.Item) {
              const harvestBerryType = harvestCheck.Item.berryType || 'blueberry';

              // Remove harvest record
              await dynamodb
                .delete({
                  TableName: DB,
                  Key: {
                    PK: bodyAsJSON.chatRoomId,
                    SK: `HARVEST#${treeId}#${connectionId}`,
                  },
                })
                .promise();

              // Add berry to player's inventory using new system
              const playerParams = {
                TableName: DB,
                Key: {
                  PK: bodyAsJSON.chatRoomId,
                  SK: "CONNECTION#" + connectionId,
                },
              };
              const playerTimer = logDynamoDBCall('get', playerParams);
              const playerData = await dynamodb.get(playerParams).promise();
              playerTimer.finish();

              if (playerData.Item) {
                // Map legacy berry type to new item ID
                const { getLegacyBerryItemId } = require('../shared/itemDefinitions.js');
                const itemId = getLegacyBerryItemId(harvestBerryType);

                if (itemId) {
                  const result = addItemToInventory(playerData.Item, itemId, 1);

                  if (result.success) {
                    // Update inventory in database
                    const updateExpression = createInventoryUpdateExpression(result.inventory);
                    const inventoryUpdateParams = {
                      TableName: DB,
                      Key: {
                        PK: bodyAsJSON.chatRoomId,
                        SK: "CONNECTION#" + connectionId,
                      },
                      ...updateExpression
                    };
                    const inventoryTimer = logDynamoDBCall('update', inventoryUpdateParams);
                    await dynamodb.update(inventoryUpdateParams).promise();
                    inventoryTimer.finish();
                  } else {
                    console.error(`Failed to add ${itemId} to inventory: ${result.error}`);
                  }
                }
              }

              // Broadcast harvest completion in parallel
              const connectionsForCompletion = await getCachedConnections(bodyAsJSON.chatRoomId);
              const harvestCompleteMessage = {
                harvestCompleted: true,
                treeId,
                berryType: harvestBerryType,
                playerId: connectionId,
                timestamp: Date.now(),
                chatRoomId: bodyAsJSON.chatRoomId,
              };

              await broadcastToConnections(connectionsForCompletion, harvestCompleteMessage);
            }
          } catch (e) {
            console.error("Error completing harvest:", e);
          }
        }, harvestDuration * 1000);

      } catch (e) {
        console.error("Error starting harvest:", e);
      }
      break;

    case "completeHarvest":
      try {
        const treeId = bodyAsJSON.treeId;

        // Check if harvest record exists and belongs to this player
        const harvestCheck = await dynamodb
          .get({
            TableName: DB,
            Key: {
              PK: bodyAsJSON.chatRoomId,
              SK: `HARVEST#${treeId}#${connectionId}`,
            },
          })
          .promise();

        if (harvestCheck.Item) {
          const harvestBerryType = harvestCheck.Item.berryType || 'blueberry';
          const harvestStartTime = harvestCheck.Item.startTime;
          const harvestDuration = harvestCheck.Item.duration;
          const currentTime = Date.now();

          // Verify harvest has been running long enough (prevent early completion)
          const elapsedTime = currentTime - harvestStartTime;
          if (elapsedTime < (harvestDuration * 1000 - 500)) { // Allow 500ms tolerance
            break;
          }

          // Remove harvest record
          await dynamodb
            .delete({
              TableName: DB,
              Key: {
                PK: bodyAsJSON.chatRoomId,
                SK: `HARVEST#${treeId}#${connectionId}`,
              },
            })
            .promise();

          // Add berry to player's inventory using new system
          const playerParams = {
            TableName: DB,
            Key: {
              PK: bodyAsJSON.chatRoomId,
              SK: "CONNECTION#" + connectionId,
            },
          };
          const playerTimer2 = logDynamoDBCall('get', playerParams);
          const playerData = await dynamodb.get(playerParams).promise();
          playerTimer2.finish();

          if (playerData.Item) {
            // Map legacy berry type to new item ID
            const { getLegacyBerryItemId } = require('../shared/itemDefinitions.js');
            const itemId = getLegacyBerryItemId(harvestBerryType);

            if (itemId) {
              const result = addItemToInventory(playerData.Item, itemId, 1);

              if (result.success) {
                // Update inventory in database
                const updateExpression = createInventoryUpdateExpression(result.inventory);
                const inventoryUpdateParams2 = {
                  TableName: DB,
                  Key: {
                    PK: bodyAsJSON.chatRoomId,
                    SK: "CONNECTION#" + connectionId,
                  },
                  ...updateExpression
                };
                const inventoryTimer2 = logDynamoDBCall('update', inventoryUpdateParams2);
                await dynamodb.update(inventoryUpdateParams2).promise();
                inventoryTimer2.finish();
              } else {
                console.error(`Failed to add ${itemId} to inventory: ${result.error}`);
              }
            }
          }

          // Get all connections to broadcast completion
          const connections = await getCachedConnections(bodyAsJSON.chatRoomId);

          // Broadcast harvest completion in parallel
          const harvestCompleteMessage = {
            harvestCompleted: true,
            treeId,
            berryType: harvestBerryType,
            playerId: connectionId,
            timestamp: Date.now(),
            chatRoomId: bodyAsJSON.chatRoomId,
          };

          await broadcastToConnections(connections, harvestCompleteMessage);
        } else {
          // No active harvest found
        }
      } catch (e) {
        logger.error("Error in manual harvest completion:", e);
      }
      break;

    case "cancelHarvest":
      try {
        const treeId = bodyAsJSON.treeId;

        // Remove harvest record if it exists
        await dynamodb
          .delete({
            TableName: DB,
            Key: {
              PK: bodyAsJSON.chatRoomId,
              SK: `HARVEST#${treeId}#${connectionId}`,
            },
          })
          .promise();

        // Get all connections to broadcast cancellation
        const connections = await getCachedConnections(bodyAsJSON.chatRoomId);

        // Broadcast harvest cancellation in parallel
        const harvestCancelMessage = {
          harvestCancelled: true,
          treeId,
          playerId: connectionId,
          timestamp: Date.now(),
          chatRoomId: bodyAsJSON.chatRoomId,
        };

        await broadcastToConnections(connections, harvestCancelMessage);
      } catch (e) {
        logger.error("Error cancelling harvest:", e);
      }
      break;

    case "consumeBerry":
      try {
        const berryType = bodyAsJSON.berryType;

        // Get player's current state from database
        const playerParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
        };
        const consumePlayerTimer = logDynamoDBCall('get', playerParams);
        const playerData = await dynamodb.get(playerParams).promise();
        consumePlayerTimer.finish();

        if (playerData.Item) {
          const currentHealth = playerData.Item.health || 0;

          // Map legacy berry type to new item ID
          const { getLegacyBerryItemId } = require('../shared/itemDefinitions.js');
          const itemId = getLegacyBerryItemId(berryType);

          if (!itemId) {
            console.error(`Invalid berry type: ${berryType}`);
            break;
          }

          // Use new inventory system to consume berry
          const consumeResult = consumeItem(playerData.Item, itemId, currentHealth, MAX_HEALTH);

          if (!consumeResult.success) {
            console.error(`Failed to consume ${itemId}: ${consumeResult.error}`);
            break;
          }

          // Update player's health and inventory in database
          const updateExpression = createInventoryUpdateExpression(consumeResult.inventory);
          updateExpression.UpdateExpression = `SET health = :newHealth, ${updateExpression.UpdateExpression.substring(4)}`; // Remove "SET " and prepend health
          updateExpression.ExpressionAttributeValues[':newHealth'] = consumeResult.effect.newHealth;

          const consumeUpdateParams = {
            TableName: DB,
            Key: {
              PK: bodyAsJSON.chatRoomId,
              SK: "CONNECTION#" + connectionId,
            },
            ...updateExpression
          };
          const consumeTimer = logDynamoDBCall('update', consumeUpdateParams);
          await dynamodb.update(consumeUpdateParams).promise();
          consumeTimer.finish();

          // Berry consumed successfully

          // Send health update back to the consuming player
          try {
            await apig
              .postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                  berryConsumed: true,
                  berryType: berryType,
                  healthRestored: consumeResult.effect.healthRestored,
                  newHealth: consumeResult.effect.newHealth,
                  timestamp: Date.now(),
                }),
              })
              .promise();
          } catch (e) {
            // Silently handle connection errors
          }

          // Get all connections to broadcast health update to other players
          const connections = await getCachedConnections(bodyAsJSON.chatRoomId);

          // Broadcast health update to other players in parallel
          const healthUpdateMessage = {
            playerHealthUpdate: true,
            playerId: connectionId,
            newHealth: consumeResult.effect.newHealth,
            timestamp: Date.now(),
            chatRoomId: bodyAsJSON.chatRoomId,
          };

          await broadcastToConnections(connections, healthUpdateMessage, connectionId);
        }
      } catch (e) {
        console.error("Error consuming berry:", e);
      }
      break;

    case "validateInventory":
      try {
        // Get player's current inventory from database
        const playerParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
        };
        const validateInventoryTimer = logDynamoDBCall('get', playerParams);
        const playerData = await dynamodb.get(playerParams).promise();
        validateInventoryTimer.finish();

        if (playerData.Item) {
          // Get inventory sync data
          const inventoryData = getInventorySyncData(playerData.Item);

          // Send authoritative inventory state back to client
          try {
            await apig
              .postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                  inventoryValidation: true,
                  inventory: inventoryData,
                  timestamp: Date.now(),
                }),
              })
              .promise();
          } catch (e) {
            console.log("couldn't send inventory validation to " + connectionId, e);
          }
        }
      } catch (e) {
        console.error("Error validating inventory:", e);
      }
      break;

    case "requestInventorySync":
      try {
        // Force inventory synchronization - same as validateInventory but with different message type
        const playerParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
        };
        const syncInventoryTimer = logDynamoDBCall('get', playerParams);
        const playerData = await dynamodb.get(playerParams).promise();
        syncInventoryTimer.finish();

        if (playerData.Item) {
          // Get inventory sync data
          const inventoryData = getInventorySyncData(playerData.Item);

          try {
            await apig
              .postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                  inventorySync: true,
                  inventory: inventoryData,
                  timestamp: Date.now(),
                }),
              })
              .promise();
          } catch (e) {
            console.log("couldn't send inventory sync to " + connectionId, e);
          }
        }
      } catch (e) {
        console.error("Error syncing inventory:", e);
      }
      break;

    case "validateGameState":
      try {
        const validationStartTime = Date.now();
        console.log(`🔍 [${connectionId}] Starting game state validation`);

        // Only get player data - harvests and ground items will be synced separately
        const gameStateParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
        };
        const gameStateTimer = logDynamoDBCall('get', gameStateParams);
        const playerData = await dynamodb.get(gameStateParams).promise();
        gameStateTimer.finish();

        const queryTime = Date.now() - validationStartTime;
        console.log(`⚡ [${connectionId}] Player data query completed in ${queryTime}ms`);

        if (playerData.Item) {
          const processingStartTime = Date.now();

          // Get inventory data
          const inventoryData = getInventorySyncData(playerData.Item);

          const gameState = {
            inventory: inventoryData,
            activeHarvests: [], // Will be synced separately via real-time updates
            groundItems: [], // Will be synced separately via real-time updates
            health: playerData.Item.health || 30,
            position: playerData.Item.lastValidPosition || { x: 0, y: 0, z: 0 },
          };

          const processingTime = Date.now() - processingStartTime;
          const totalTime = Date.now() - validationStartTime;

          console.log(`📊 [${connectionId}] Game state validation completed in ${totalTime}ms (queries: ${queryTime}ms, processing: ${processingTime}ms)`);
          console.log(`📦 [${connectionId}] Game state: inventory and health only (harvests/ground items synced separately)`);

          // Send comprehensive game state back to client
          try {
            await apig
              .postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                  gameStateValidation: true,
                  gameState: gameState,
                  timestamp: Date.now(),
                }),
              })
              .promise();
          } catch (e) {
            console.log("couldn't send game state validation to " + connectionId, e);
          }
        } else {
          console.warn(`⚠️ [${connectionId}] Player data not found during game state validation`);
        }
      } catch (e) {
        const totalTime = Date.now() - validationStartTime;
        console.error(`❌ [${connectionId}] Error validating game state after ${totalTime}ms:`, e);

        // Send error response to client
        try {
          await apig
            .postToConnection({
              ConnectionId: connectionId,
              Data: JSON.stringify({
                gameStateValidation: false,
                error: "Failed to validate game state",
                timestamp: Date.now(),
              }),
            })
            .promise();
        } catch (sendError) {
          console.error(`Failed to send error response to ${connectionId}:`, sendError);
        }
      }
      break;

    case "dropItem":
      try {
        const { itemId, quantity = 1 } = bodyAsJSON;

        if (!itemId) {
          console.error("Missing required itemId for dropItem");
          break;
        }

        // Get player's current inventory and verified position
        const playerParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
        };
        const dropPlayerTimer = logDynamoDBCall('get', playerParams);
        const playerData = await dynamodb.get(playerParams).promise();
        dropPlayerTimer.finish();

        if (!playerData.Item) {
          console.error("Player not found for dropItem");
          break;
        }

        // Use server's verified position instead of client-sent position
        const verifiedPosition = playerData.Item.lastValidPosition || SPAWN_LOCATION.position;
        console.log(`Using server verified position for drop: ${JSON.stringify(verifiedPosition)} (player: ${connectionId})`);

        // Use new inventory system to remove item
        const removeResult = removeItemFromInventory(playerData.Item, itemId, quantity);

        if (!removeResult.success) {
          console.error(`Failed to remove ${quantity} ${itemId} from inventory: ${removeResult.error}`);
          break;
        }

        // Update inventory in database
        const updateExpression = createInventoryUpdateExpression(removeResult.inventory);
        const dropUpdateParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
          ...updateExpression
        };
        const dropTimer = logDynamoDBCall('update', dropUpdateParams);
        await dynamodb.update(dropUpdateParams).promise();
        dropTimer.finish();

        // Create ground item at server's verified position
        const groundItemId = `GROUND_ITEM#${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const groundItemData = createGroundItemData(
          itemId,
          quantity,
          verifiedPosition,
          connectionId
        );

        const groundItemPutParams = {
          TableName: DB,
          Item: {
            PK: bodyAsJSON.chatRoomId,
            SK: groundItemId,
            ...groundItemData,
          },
        };
        const groundItemTimer = logDynamoDBCall('put', groundItemPutParams);
        await dynamodb.put(groundItemPutParams).promise();
        groundItemTimer.finish();

        // Broadcast ground item creation to all players in parallel
        const connections = await getCachedConnections(bodyAsJSON.chatRoomId);

        const groundItemMessage = {
          type: "groundItemCreated",
          groundItem: {
            id: groundItemId,
            ...groundItemData,
          },
          timestamp: Date.now(),
          chatRoomId: bodyAsJSON.chatRoomId,
        };

        await broadcastToConnections(connections, groundItemMessage);

        console.log(`Player ${connectionId} dropped ${quantity} ${itemId} at verified position`, verifiedPosition);

      } catch (e) {
        console.error("Error dropping item:", e);
      }
      break;

    case "pickupItem":
      try {
        const { groundItemId } = bodyAsJSON;

        if (!groundItemId) {
          console.error("Missing groundItemId for pickupItem");
          break;
        }

        // Get ground item
        const groundItemParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: groundItemId,
          },
        };

        const pickupGroundTimer = logDynamoDBCall('get', groundItemParams);
        const groundItemData = await dynamodb.get(groundItemParams).promise();
        pickupGroundTimer.finish();

        if (!groundItemData.Item) {
          console.error("Ground item not found for pickup");
          break;
        }

        const groundItem = groundItemData.Item;

        // Get player data for inventory update
        const playerParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
        };
        const pickupPlayerTimer = logDynamoDBCall('get', playerParams);
        const playerData = await dynamodb.get(playerParams).promise();
        pickupPlayerTimer.finish();

        if (!playerData.Item) {
          console.error("Player not found for pickupItem");
          break;
        }

        // Convert ground item to inventory item format
        const inventoryItem = groundItemToInventoryItem(groundItem);

        // Add item to player's inventory using new system
        const addResult = addItemToInventory(
          playerData.Item,
          inventoryItem.itemId,
          inventoryItem.quantity,
          inventoryItem.metadata
        );

        if (!addResult.success) {
          console.error(`Failed to add ${inventoryItem.itemId} to inventory: ${addResult.error}`);
          break;
        }

        // Update inventory in database
        const updateExpression = createInventoryUpdateExpression(addResult.inventory);
        const pickupUpdateParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: "CONNECTION#" + connectionId,
          },
          ...updateExpression
        };
        const pickupUpdateTimer = logDynamoDBCall('update', pickupUpdateParams);
        await dynamodb.update(pickupUpdateParams).promise();
        pickupUpdateTimer.finish();

        // Remove ground item
        const pickupDeleteParams = {
          TableName: DB,
          Key: {
            PK: bodyAsJSON.chatRoomId,
            SK: groundItemId,
          },
        };
        const pickupDeleteTimer = logDynamoDBCall('delete', pickupDeleteParams);
        await dynamodb.delete(pickupDeleteParams).promise();
        pickupDeleteTimer.finish();

        // Broadcast ground item removal to all players in parallel
        const connections = await getCachedConnections(bodyAsJSON.chatRoomId);

        const groundItemRemovalMessage = {
          type: "groundItemRemoved",
          groundItemId,
          pickedUpBy: connectionId,
          timestamp: Date.now(),
          chatRoomId: bodyAsJSON.chatRoomId,
        };

        await broadcastToConnections(connections, groundItemRemovalMessage);

        logger.debug(`Player ${connectionId} picked up ${inventoryItem.quantity} ${inventoryItem.itemId}`);

      } catch (e) {
        logger.error("Error picking up item:", e);
      }
      break;
  }

  // Return a 200 status to tell API Gateway the message was processed
  // successfully.
  // Otherwise, API Gateway will return a 500 to the client.
  return { statusCode: 200 };
};

// Export handler for testing
module.exports = {
  handler: exports.handler,
};

// /openChatRoom - get messages for chatroom
// header: token
// body: {
//       chatRoomId: xxx
// }
module.exports.openChatRoom = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  const decoded = jwt.decode(
    event.headers.Authorization,
    process.env.JWT_SECRET
  );
  try {
    const params = {
      TableName: process.env.DB,
      KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": data.chatRoomId, ":sk": "MESSAGE#" },
    };
    const messagesTimer = logDynamoDBCall('query', params);
    const getMessages = await dynamodb.query(params).promise();
    messagesTimer.finish();
    callback(
      null,
      helpers.validCallbackObject({ messages: getMessages.Items })
    );
  } catch (e) {
    console.error(e);
  }
};

// /getChatRooms - get chat rooms for user
// header: token
module.exports.getChatRooms = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  const decoded = jwt.decode(
    event.headers.Authorization,
    process.env.JWT_SECRET
  );
  try {
    const getChatRoomsParams = {
      TableName: process.env.DB,
      KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": decoded.PK, ":sk": "CHATROOM#" },
    };
    const chatRoomsTimer = logDynamoDBCall('query', getChatRoomsParams);
    let chatRooms = await dynamodb.query(getChatRoomsParams).promise();
    chatRoomsTimer.finish();
    for (let chatRoom of chatRooms.Items) {
      const getChatRoomUsersParams = {
        TableName: process.env.DB,
        KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": chatRoom.SK, ":sk": "USER#" },
      };
      const chatRoomUsersTimer = logDynamoDBCall('query', getChatRoomUsersParams);
      const chatRoomUsers = await dynamodb.query(getChatRoomUsersParams).promise();
      chatRoomUsersTimer.finish();
      // Avoid sending back user guid
      chatRoomUsers.Items.forEach((x) => delete x.SK);
      chatRoom.users = chatRoomUsers.Items;
    }

    // Avoid sending back user guid
    chatRooms.Items.forEach((x) => delete x.PK);
    callback(null, helpers.validCallbackObject({ rooms: chatRooms.Items }));
  } catch (e) {
    console.error(e);
  }
};

// /createChatRoom - creates rows in db necessary for chatroom
// header: token
// body: {
//   name: "chatroomName"
// }
module.exports.createChatRoom = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  const decoded = jwt.decode(
    event.headers.Authorization,
    process.env.JWT_SECRET
  );

  try {
    const chatRoomId = "CHATROOM#" + uuid.v1();
    const timestamp = new Date().getTime();

    const getHandleParams = {
      TableName: process.env.DB,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": decoded.PK },
    };
    const getHandleTimer = logDynamoDBCall('query', getHandleParams);
    const getHandle = await dynamodb.query(getHandleParams).promise();
    getHandleTimer.finish();
    const handle = getHandle.Items[0].handle;
    const roomParams = {
      TableName: process.env.DB,
      Item: {
        PK: chatRoomId,
        SK: decoded.PK,
        handle: handle,
        name: data.name,
        modified: timestamp,
      },
    };
    const roomTimer = logDynamoDBCall('put', roomParams);
    await dynamodb.put(roomParams).promise();
    roomTimer.finish();

    const userParams = {
      TableName: process.env.DB,
      Item: {
        PK: decoded.PK,
        SK: chatRoomId,
        handle: handle,
        created: timestamp,
      },
    };
    const userTimer = logDynamoDBCall('put', userParams);
    await dynamodb.put(userParams).promise();
    userTimer.finish();

    callback(null, helpers.validCallbackObject({ chatRoomId }));
  } catch (e) {
    console.error(e);
    callback(null, helpers.invalidCallbackObject("Failed to create chatroom"));
  }
};
