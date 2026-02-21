import express from "express";
import http from "http";
import { Server } from "socket.io";
import axios from "axios";
import cors from "cors";

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 5000;

app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.json());

io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);
  
  let currentUserId = null;

  // identity
  socket.on("identity", async (userId) => {
    if (!userId) return;
    
    currentUserId = userId;
    socket.join(userId);
    console.log(`👤 User ${userId} joined personal room`); // FIXED: Added backticks
    
    try {
      await axios.post("http://localhost:3000/api/socket/connect", {
        userId,
        socketId: socket.id,
      });
      socket.emit("identity");
    } catch (err) {
      console.error("❌ Error in identity handler:", err.message);
    }
  });


  socket.on("join-order", (orderId) => {
    const roomName = `order_${orderId}`;
    socket.join(roomName); // FIXED: Added backticks and proper call
    console.log(`📌 Joined room: ${roomName}, Socket ID: ${socket.id}`); // FIXED: Added backticks
    
    // Send confirmation back to client
    socket.emit("joined-order", { orderId, room: roomName });
  });

  // delivery boy location
  socket.on("deli-loc", ({ orderId, lat, lon }) => {
    const roomName = `order_${orderId}`;
    
    console.log(`📍 Broadcasting location to room ${roomName}:`, { lat, lon }); // FIXED: Added backticks
    
    // Broadcast to everyone in the room INCLUDING the sender
    io.to(roomName).emit("deli-loc", { orderId, lat, lon });
    
    // Alternative: If you want to exclude the sender, use:
    // socket.to(roomName).emit("deli-loc", { orderId, lat, lon });
  });

  // leave-order room (cleanup)
  socket.on("leave-order", (orderId) => {
    const roomName = `order_${orderId}`;
    socket.leave(roomName);
    console.log(`📌 Left room: ${roomName}`);
  });

  // orders
  socket.on("orders", async (data) => {
    try {
      if (!currentUserId || currentUserId !== data.userId) {
        return console.log("⚠️ Order rejected: identity mismatch");
      }

      const shop = await axios.post("http://localhost:3000/api/user/order", data);
      const orderId = shop.data.order._id;
      
      const fullOrder = await axios.get(
        `http://localhost:3000/api/user/order?orderId=${orderId}`
      );

 
      io.to(data.userId).emit("new-order", fullOrder.data);
      io.to(data.userId).emit("status", fullOrder.data.status);
      
      io.to(data.userId).emit("join-this-order", orderId);

      // send to admins
      const adminSockets = await io.in("admin").fetchSockets();
      if (adminSockets.length > 0) {
        io.to("admin").emit("admin-new-order", fullOrder.data);
      }
    } catch (err) {
      console.error("❌ Order processing error:", err.message);
    }
  });

  // payment
  socket.on("payment", async ({ orderItems, total, userId, address }) => {
    try {
      const { data } = await axios.post("http://localhost:3000/api/user/payment", {
        userId,
        items: orderItems,
        paymentMethod: "online",
        totalAmount: total,
        address,
      });
      socket.emit("payment-url", data.url);
    } catch (err) {
      console.error("Payment error:", err.message);
    }
  });

  socket.on("update-location", async ({ userId, latitude, longitude }) => {
    try {
      await axios.post("http://localhost:3000/api/socket/geoupdater", {
        userId,
        latitude,
        longitude,
      });
    } catch (err) {
      console.error("Geo update error:", err.message);
    }
  });

  socket.on("customer-location", (data) => {
  console.log("🔥 customer-location received:", data);

  const roomName = `order_${data.orderId}`;

  io.to(roomName).emit("customer-location", {
    orderId: data.orderId,
    lat: data.lat,
    lon: data.lon,
  });

  console.log(`📡 Broadcasted customer-location to ${roomName}`);
});

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

app.post("/notify", (req, res) => {
  const { socketId, event, data } = req.body;
  
  if (socketId) {
    io.to(socketId).emit(event, data);
  } else {
    io.emit(event, data);
  }
  
  return res.status(200).json({ success: true });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", connections: io.engine.clientsCount });
});

server.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
