import { auth } from './Auth'

let url = "https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/"
let wsUrl = "wss://ahftzn2xw8.execute-api.ap-southeast-2.amazonaws.com/dev/"
// if (process.env.NODE_ENV === 'development')  {
//   url = "http://localhost:3000/dev/";
//   wsUrl = "ws://localhost:3001";
// }
const connectedUsers: any = {};
let allConnections: any = [];
let clientConnectionId = null;

export const webSocketConnection = new WebSocket(wsUrl);

let appendChatLog: any = null;
export const setAppendChatLog = (method: any) => {appendChatLog = method};
let setUserPositions: any = null;
export const setSetUserPositions = (method: any) => {setUserPositions = method};

const defaultHeaders = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Authorization': ""
}

export const serverPOST = async (endpoint: string, inputData: any, withToken=true) => {
  let headers = defaultHeaders;
  if (withToken && defaultHeaders.Authorization === "") 
    headers.Authorization = await auth.getToken() || "";

  const fetchData = await fetch(url+endpoint, {
    headers,
    method: 'POST',
    body: JSON.stringify(inputData)
  }).catch(e => {
    console.log("serverPOST error", e);
  });
  const JSONData = await fetchData.json();
  JSONData.status = fetchData.status;
  return JSONData;
}

export const serverGET = async (endpoint: string, withToken=true) => {
  let headers = defaultHeaders;
  if (withToken && defaultHeaders.Authorization === "") 
    headers.Authorization = await auth.getToken() || "";
  return await fetch(url+endpoint, {
    headers,
    method: 'GET',
  })
}


export const webSocketConnect = () => {
  webSocketConnection.onerror = _webSocketError;
  webSocketConnection.onclose = _webSocketClose;
  webSocketConnection.onmessage = _webSocketMessageReceived;
  connectToChatRoom();
}

export const webSocketSaveConnection = async () => {
  try {
    const token = await auth.getToken();
    if (token) {
      const payload = {
        token,
        action: "saveConnection",
      }
      webSocketConnection?.send(JSON.stringify(payload));
    }
  } catch (e) {
    console.error("webSocketSaveConnection Error:", e);
  }
}

interface PositionMessage {
  // userId: string | number;
  position: string | number;
  rotation: string | number;
}

export const webSocketSendPosition = async (message: PositionMessage) => {
  try {
    const token = await auth.getToken();
    const payload = {
      token,
      message,
      connections: allConnections,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "sendPosition",
    }
    webSocketConnection?.send(JSON.stringify(payload));
  } catch (e) {
    console.error("webSocketSendMessage Error:", e);
    setTimeout(() => {
      webSocketSendPosition(message);
    }, 500);
  }
}

export const webSocketSendMessage = async (message: string) => {
  try {
    const token = await auth.getToken();
    const payload = {
      token,
      message,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "sendMessagePublic",
    }
    webSocketConnection?.send(JSON.stringify(payload));
  } catch (e) {
    console.error("webSocketSendMessage Error:", e);
  }
}

export const connectToChatRoom = async (chatRoomId: string = "") => {
  try {
    const token = await auth.getToken();
    const payload = {
      token,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "connectToChatRoom",
    }
    webSocketConnection?.send(JSON.stringify(payload));
  } catch (e) {
    console.log("webSocketSaveConnection Error:", e);
    setTimeout(() => {
      connectToChatRoom(chatRoomId);
    }, 500);
  }
}

const _webSocketMessageReceived = (e) => {
  if (e.data) {
    const messageObject = JSON.parse(e.data);
    if (messageObject.chatMessage)
      appendChatLog(messageObject);
    if (messageObject.position && messageObject.userId) {
      updateUserPosition(messageObject);
    }
    if (messageObject.connections) {
      updateConnections(messageObject.connections);
      clientConnectionId = messageObject.yourConnectionId;
    }
  }
}

const _webSocketError = (e: Event) => {
  console.error("Websocket error:", e);
}

const _webSocketClose = (e: Event) => {
  console.log("Websocket close:", e);
}

const updateConnections = (connections: any) => {
  const tempAllConnections = [];
  for (const item of connections) {
    tempAllConnections.push(item.SK.split("#")[1]);
  }
  allConnections = tempAllConnections;
}

const updateUserPosition = (newData: any) => {
  newData.selfDestroyTime = (new Date().getTime()) + 5000;
  connectedUsers[newData.userId] = newData;
  setUserPositions(connectedUsers);
  if (allConnections.indexOf(newData.connectionId) === -1)
    allConnections.push(newData.connectionId);
}

export const deleteUserPosition = (userId: string) => {
  delete connectedUsers[userId];
}

export const getUserPositions = () => {
  return connectedUsers;
}

export const getClientConnectionId = () => {
  return clientConnectionId;
}
