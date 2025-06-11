import React, { useEffect } from "react";
import {
  useChatStore,
  useOtherUsersStore,
  useUserStateStore,
  useWebsocketStore,
  useHarvestStore,
  useInventoryStore,
} from "../store";

const Api = (props) => {
  let url = "https://dm465kqzfi.execute-api.ap-southeast-2.amazonaws.com/dev/";
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
  const addDamageToRender = useOtherUsersStore(
    (state: any) => state.addDamageToRender
  );
  const setPlayerHealth = useOtherUsersStore(
    (state: any) => state.setPlayerHealth
  );
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
  const addItem = useInventoryStore((state: any) => state.addItem);
  const setIsDead = useUserStateStore((state: any) => state.setIsDead);
  const setIsRespawning = useUserStateStore(
    (state: any) => state.setIsRespawning
  );
  const setHealth = useUserStateStore((state: any) => state.setHealth);

  if (process.env.NODE_ENV === "development") {
    url = "http://localhost:3000/dev/";
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

      if (messageObject.position && messageObject.userId) {
        updateUserPosition(messageObject);
        if (messageObject.attackingPlayer)
          addDamageToRender(messageObject.damageGiven);
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
        if (messageObject.playerId === userConnectionId) {
          // Add berry to inventory for the harvesting player
          addItem({
            type: "berry",
            name: "Berry",
            icon: "/berry.svg",
            quantity: 1,
          });
        }
      }

      // Handle death event
      if (messageObject.type === "playerDeath") {
        console.log("Player death event received:", messageObject);
        if (messageObject.deadPlayerId === userConnectionId) {
          setIsDead(true);
          console.log("Current player has died");
        }
      }

      // Handle respawn event
      if (messageObject.type === "playerRespawn") {
        console.log("Player respawn event received:", messageObject);
        if (messageObject.playerId === userConnectionId) {
          setIsDead(false);
          setIsRespawning(true);
          setHealth(messageObject.health);
          console.log("Current player is respawning");

          // Reset respawning flag after a short delay
          setTimeout(() => {
            setIsRespawning(false);
          }, 1000);
        } else {
          // Update health for other players when they respawn
          setPlayerHealth(messageObject.playerId, messageObject.health);
          console.log(
            `Other player ${messageObject.playerId} respawned with health ${messageObject.health}`
          );
        }
      }
    }
  };

  const _webSocketError = (e: Event) => {
    console.error("Websocket error:", e);
  };

  const _webSocketClose = (e: Event) => {
    console.log("Websocket close:", e);
  };

  //Initialize Websocket
  useEffect(() => {
    const webSocketConnection = new WebSocket(wsUrl);
    webSocketConnection.onerror = _webSocketError;
    webSocketConnection.onclose = _webSocketClose;
    webSocketConnection.onmessage = _webSocketMessageReceived;
    setWebSocket(webSocketConnection);
  }, []);

  return <div> </div>;
};

export default Api;
