import React, { useEffect } from "react";
import { useChatStore, useWebsocketStore } from "../store";

const Api = (props) => {
  let url = "https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/";
  let wsUrl = "wss://ahftzn2xw8.execute-api.ap-southeast-2.amazonaws.com/dev/";
  const setWebSocket = useWebsocketStore((state: any) => state.setWebSocket);
  const addChatMessage = useChatStore((state: any) => state.addChatMessage);

  // if (process.env.NODE_ENV === 'development')  {
  //   url = "http://localhost:3000/dev/";
  //   wsUrl = "ws://localhost:3001";
  // }
  const connectedUsers: any = {};
  let allConnections: any = [];
  let clientConnectionId = null;

  const updateUserPosition = (newData: any) => {
    newData.selfDestroyTime = new Date().getTime() + 5000;
    connectedUsers[newData.userId] = newData;
    // setUserPositions(connectedUsers);
    if (allConnections.indexOf(newData.connectionId) === -1)
      allConnections.push(newData.connectionId);
  };

  const updateConnections = (connections: any) => {
    const tempAllConnections = [];
    for (const item of connections) {
      tempAllConnections.push(item.SK.split("#")[1]);
    }
    allConnections = tempAllConnections;
  };

  const _webSocketMessageReceived = (e) => {
    console.log("receiv");
    console.log(e, "e");
    if (e.data) {
      const messageObject = JSON.parse(e.data);
      if (messageObject.chatMessage) {
        addChatMessage(messageObject);
        // onNewMessage(messageObject);
      }
      // if (messageObject.position && messageObject.userId) {
      //   updateUserPosition(messageObject);
      // }
      if (messageObject.connections) {
        updateConnections(messageObject.connections);
        clientConnectionId = messageObject.yourConnectionId;
      }
    }
  };

  const _webSocketError = (e: Event) => {
    console.error("Websocket error:", e);
  };

  const _webSocketClose = (e: Event) => {
    console.log("Websocket close:", e);
  };

  useEffect(() => {
    const webSocketConnection = new WebSocket(wsUrl);
    webSocketConnection.onerror = _webSocketError;
    webSocketConnection.onclose = _webSocketClose;
    webSocketConnection.onmessage = _webSocketMessageReceived;
    // connectToChatRoom();
    setWebSocket(webSocketConnection);
    console.log("set", webSocketConnection);
  }, []);

  return <div> </div>;
};

export default Api;
