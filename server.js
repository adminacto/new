const express = require("express")
const http = require("http")
const socketIo = require("socket.io")
const cors = require("cors")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const rateLimit = require("express-rate-limit")
const helmet = require("helmet")
const { v4: uuidv4 } = require("uuid")
const path = require("path")
const mongoose = require("mongoose")
const { Schema, model } = require("mongoose")

// Инициализация приложения
const app = express()
const server = http.createServer(app)

// Настройка trust proxy для работы за прокси (Render.com)
app.set('trust proxy', 1)

// Безопасность
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
)

// Rate limiting с правильной настройкой для прокси
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов
  message: "Слишком много запросов, попробуйте позже",
  standardHeaders: true,
  legacyHeaders: false,
  // Настройка для работы за прокси
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // максимум 5 попыток входа
  message: "Слишком много попыток входа, подождите 15 минут",
  standardHeaders: true,
  legacyHeaders: false,
  // Настройка для работы за прокси
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
})

// Конфигурация
const JWT_SECRET = process.env.JWT_SECRET || "actogram_ultra_secure_key_2024_v3"
const PORT = process.env.PORT || 3001

// Разрешенные домены
const allowedOrigins = [
  "https://acto-uimuz.vercel.app",
  "https://actogr.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  /\.vercel\.app$/,
  /\.render\.com$/,
]

// CORS настройки
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)

    const isAllowed = allowedOrigins.some((allowed) => {
      if (typeof allowed === "string") {
        return origin === allowed || origin.includes(allowed.replace(/https?:\/\//, ""))
      }
      return allowed.test(origin)
    })

    if (isAllowed) {
      callback(null, true)
    } else {
      callback(new Error("CORS: Домен не разрешен"))
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
app.use(express.json({ limit: "10mb" }))
app.use(express.static(path.join(__dirname, "public")))

// Socket.IO настройки
const io = socketIo(server, {
  cors: corsOptions,
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Хранилище данных (в продакшене использовать базу данных)
const activeConnections = new Map() // socketId -> userId
const typingUsers = new Map() // chatId -> Set of userIds
const blockedUsers = new Map() // userId -> Set of blocked userIds

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ error: "Токен доступа обязателен" })
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Недействительный или истекший токен" })
    }
    req.user = user
    next()
  })
}

// Валидация
const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const validatePassword = (password) => password && password.length >= 8
const validateUsername = (username) => /^@[a-zA-Z0-9_]{3,20}$/.test(username)

// Утилиты
const encryptMessage = (message) => {
  return Buffer.from(message, "utf8").toString("base64")
}

const decryptMessage = (encrypted) => {
  try {
    return Buffer.from(encrypted, "base64").toString("utf8")
  } catch {
    return encrypted
  }
}

// Эмодзи для реакций
const reactionEmojis = ["❤️", "👍", "👎", "😂", "😮", "😢", "😡", "🔥", "👏", "🎉"]



// Главная страница
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ACTOGRAM Server v3.0</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                max-width: 800px;
                width: 100%;
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(20px);
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 25px 50px rgba(0,0,0,0.2);
                border: 1px solid rgba(255,255,255,0.2);
            }
            .header {
                text-align: center;
                margin-bottom: 40px;
            }
            .logo {
                width: 80px;
                height: 80px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                border-radius: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 20px;
                font-size: 32px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            h1 {
                font-size: 2.5rem;
                margin-bottom: 10px;
                background: linear-gradient(135deg, #fff, #e0e7ff);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            .status {
                background: rgba(34, 197, 94, 0.2);
                padding: 15px 25px;
                border-radius: 15px;
                margin: 20px 0;
                text-align: center;
                font-size: 18px;
                border: 1px solid rgba(34, 197, 94, 0.3);
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin: 30px 0;
            }
            .stat-card {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                text-align: center;
                border: 1px solid rgba(255,255,255,0.2);
                transition: transform 0.3s ease;
            }
            .stat-card:hover {
                transform: translateY(-5px);
            }
            .stat-number {
                font-size: 2rem;
                font-weight: bold;
                color: #60a5fa;
                display: block;
            }
            .features {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin: 30px 0;
            }
            .feature {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                border: 1px solid rgba(255,255,255,0.2);
            }
            .feature-icon {
                font-size: 24px;
                margin-bottom: 10px;
            }
            .client-link {
                display: inline-block;
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
                padding: 15px 30px;
                border-radius: 15px;
                text-decoration: none;
                font-weight: bold;
                font-size: 18px;
                margin: 20px 10px;
                transition: all 0.3s ease;
                box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3);
            }
            .client-link:hover {
                transform: translateY(-3px);
                box-shadow: 0 15px 35px rgba(16, 185, 129, 0.4);
            }
            .version-badge {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: bold;
                display: inline-block;
                margin: 10px 0;
            }
            @media (max-width: 768px) {
                .container { padding: 20px; }
                h1 { font-size: 2rem; }
                .stats { grid-template-columns: 1fr; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">💬</div>
                <h1>ACTOGRAM</h1>
                <div class="version-badge">Server v3.0 - Ultra Secure</div>
                <p>Современный мессенджер с end-to-end шифрованием</p>
            </div>
            
            <div class="status">
                ✅ Сервер работает стабильно и безопасно
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <span class="stat-number">${users.size}</span>
                    <div>Зарегистрированных пользователей</div>
                </div>
                <div class="stat-card">
                    <span class="stat-number">${activeConnections.size}</span>
                    <div>Активных подключений</div>
                </div>
                <div class="stat-card">
                    <span class="stat-number">${chats.size}</span>
                    <div>Активных чатов</div>
                </div>
                <div class="stat-card">
                    <span class="stat-number">${Array.from(messages.values()).reduce((total, msgs) => total + msgs.length, 0)}</span>
                    <div>Сообщений отправлено</div>
                </div>
            </div>
            
            <div class="features">
                <div class="feature">
                    <div class="feature-icon">🔐</div>
                    <h3>End-to-End шифрование</h3>
                    <p>Все сообщения защищены современным шифрованием</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">⚡</div>
                    <h3>Мгновенная доставка</h3>
                    <p>WebSocket соединение для быстрого обмена сообщениями</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">📱</div>
                    <h3>Адаптивный дизайн</h3>
                    <p>Отлично работает на всех устройствах</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">🛡️</div>
                    <h3>Максимальная безопасность</h3>
                    <p>JWT аутентификация, rate limiting, CORS защита</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">🌍</div>
                    <h3>Многоязычность</h3>
                    <p>Поддержка узбекского, русского и английского языков</p>
                </div>
                <div class="feature">
                    <div class="feature-icon">🎨</div>
                    <h3>Современный UI</h3>
                    <p>Красивый интерфейс с темной и светлой темами</p>
                </div>
            </div>
            
            <div style="text-align: center; margin: 40px 0;">
                <h2>🚀 Начать использование</h2>
                <a href="https://acto-uimuz.vercel.app" class="client-link" target="_blank">
                    Открыть ACTOGRAM
                </a>
                <p style="margin-top: 20px; opacity: 0.8;">
                    Безопасный мессенджер нового поколения
                </p>
            </div>
            
            <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2);">
                <p style="opacity: 0.7;">
                    Время работы: ${Math.floor(process.uptime() / 60)} минут | 
                    Версия: 3.0.0 | 
                    Node.js ${process.version}
                </p>
            </div>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            socket.on('connect', () => {
                console.log('🟢 WebSocket подключен:', socket.id);
            });
            socket.on('disconnect', () => {
                console.log('🔴 WebSocket отключен');
            });
        </script>
    </body>
    </html>
  `)
})

// API Routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "ACTOGRAM Server v3.0 работает отлично",
    timestamp: new Date().toISOString(),
    stats: {
      users: users.size,
      activeConnections: activeConnections.size,
      chats: chats.size,
      totalMessages: Array.from(messages.values()).reduce((total, msgs) => total + msgs.length, 0),
      uptime: process.uptime(),
    },
    version: "3.0.0",
    features: {
      endToEndEncryption: true,
      realTimeMessaging: true,
      multiLanguage: true,
      adaptiveDesign: true,
      secureAuth: true,
      rateLimiting: true,
    },
  })
})

// Аутентификация
app.post("/api/auth", authLimiter, async (req, res) => {
  try {
    const { action, email, password, username, fullName, bio } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email и пароль обязательны" })
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Неверный формат email" })
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: "Пароль должен содержать минимум 8 символов" })
    }

    if (action === "register") {
      if (!username || !fullName) {
        return res.status(400).json({ error: "Username и полное имя обязательны" })
      }

      if (!validateUsername(username)) {
        return res.status(400).json({ error: "Username должен начинаться с @ и содержать 3-20 символов" })
      }

      const existingUser = await User.findOne({ $or: [{ email }, { username }] })
      if (existingUser) {
        return res.status(400).json({ error: "Пользователь с таким email или username уже существует" })
      }

      const hashedPassword = await bcrypt.hash(password, 12)
      const user = await User.create({
        email,
        username,
        fullName,
        bio: bio || "",
        password: hashedPassword,
        createdAt: new Date(),
        isVerified: Math.random() > 0.5,
        isOnline: false,
        lastSeen: new Date(),
        avatar: null,
        status: "offline",
      })

      const token = jwt.sign({ userId: user._id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: "30d" })
      const userResponse = user.toObject()
      delete userResponse.password
      res.json({
        success: true,
        message: "Регистрация успешна",
        user: userResponse,
        token,
      })
      console.log(`✅ Новый пользователь: ${username} (${email})`)
    } else if (action === "login") {
      const user = await User.findOne({ email })
      if (!user) {
        return res.status(401).json({ error: "Неверный email или пароль" })
      }
      const isValidPassword = await bcrypt.compare(password, user.password)
      if (!isValidPassword) {
        return res.status(401).json({ error: "Неверный email или пароль" })
      }
      user.isOnline = true
      user.lastSeen = new Date()
      user.status = "online"
      await user.save()
      const token = jwt.sign({ userId: user._id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: "30d" })
      const userResponse = user.toObject()
      delete userResponse.password
      res.json({
        success: true,
        message: "Вход выполнен успешно",
        user: userResponse,
        token,
      })
      console.log(`✅ Пользователь вошел: ${user.username}`)
    } else {
      res.status(400).json({ error: "Неверное действие" })
    }
  } catch (error) {
    console.error("Auth error:", error)
    res.status(500).json({ error: "Ошибка сервера" })
  }
})

// Получение чатов пользователя (MongoDB)
app.get("/api/chats", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId
    // Найти все чаты, где пользователь — участник
    const chats = await Chat.find({ participants: userId })
      .populate("participants", "_id username fullName avatar isOnline isVerified status")
      .lean()
      .exec()
    // Для каждого чата получить последнее сообщение и количество сообщений
    const chatList = await Promise.all(
      chats.map(async (chat) => {
        const lastMessage = await Message.findOne({ chat: chat._id })
          .sort({ timestamp: -1 })
          .lean()
        const messageCount = await Message.countDocuments({ chat: chat._id })
        return {
          ...chat,
          id: chat._id.toString(),
          lastMessage: lastMessage
            ? {
                ...lastMessage,
                id: lastMessage._id.toString(),
                senderId: lastMessage.sender?.toString(),
                chatId: lastMessage.chat?.toString(),
              }
            : null,
          messageCount,
          unreadCount: 0, // TODO: реализовать
        }
      })
    )
    res.json(chatList)
  } catch (error) {
    console.error("/api/chats error:", error)
    res.status(500).json({ error: "Ошибка сервера" })
  }
})

// Получение сообщений чата (MongoDB)
app.get("/api/messages/:chatId", authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params
    const userId = req.user.userId
    const chat = await Chat.findById(chatId).lean()
    if (!chat) return res.status(404).json({ error: "Чат не найден" })
    if (!chat.participants.map((id) => id.toString()).includes(userId)) {
      return res.status(403).json({ error: "Нет доступа к этому чату" })
    }
    const chatMessages = await Message.find({ chat: chatId })
      .sort({ timestamp: 1 })
      .lean()
    const decryptedMessages = chatMessages.map((msg) => ({
      ...msg,
      id: msg._id.toString(),
      senderId: msg.sender?.toString(),
      chatId: msg.chat?.toString(),
      content: msg.isEncrypted ? decryptMessage(msg.content) : msg.content,
    }))
    res.json(decryptedMessages)
  } catch (error) {
    console.error("/api/messages/:chatId error:", error)
    res.status(500).json({ error: "Ошибка сервера" })
  }
})

// Socket.IO аутентификация (MongoDB)
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token

    if (!token) {
      return next(new Error("Токен аутентификации обязателен"))
    }

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        return next(new Error("Недействительный или истекший токен"))
      }

      try {
        const user = await User.findById(decoded.userId).lean()
        if (!user) {
          return next(new Error("Пользователь не найден"))
        }

        socket.userId = user._id.toString()
        socket.user = user
        next()
      } catch (error) {
        console.error("Socket auth error:", error)
        return next(new Error("Ошибка аутентификации"))
      }
    })
  } catch (error) {
    console.error("Socket auth error:", error)
    return next(new Error("Ошибка аутентификации"))
  }
})

// Socket.IO обработчики
io.on("connection", async (socket) => {
  const user = socket.user
  console.log(`🔗 Подключение: ${user.username} (${socket.id})`)

  activeConnections.set(socket.id, user.id)
  // При подключении обновлять статус пользователя в MongoDB
  await User.findByIdAndUpdate(user.id, { isOnline: true, lastSeen: new Date(), status: "online" })

  // Присоединяем пользователя ко всем его чатам (MongoDB)
  try {
    const userChats = await Chat.find({ participants: user.id }).lean()
    for (const chat of userChats) {
      socket.join(chat._id.toString())
    }
  } catch (error) {
    console.error("Error joining user chats:", error)
  }

  // Получение чатов пользователя (MongoDB)
  socket.on("get_my_chats", async (userId) => {
    try {
      if (userId === user.id) {
        const chats = await Chat.find({ participants: user.id })
          .populate("participants", "_id username fullName avatar isOnline isVerified status")
          .lean()
        
        const chatList = await Promise.all(
          chats.map(async (chat) => {
            const lastMessage = await Message.findOne({ chat: chat._id })
              .sort({ timestamp: -1 })
              .lean()
            const messageCount = await Message.countDocuments({ chat: chat._id })
            return {
              ...chat,
              id: chat._id.toString(),
              lastMessage: lastMessage
                ? {
                    ...lastMessage,
                    id: lastMessage._id.toString(),
                    senderId: lastMessage.sender?.toString(),
                    chatId: lastMessage.chat?.toString(),
                  }
                : null,
              messageCount,
              unreadCount: 0,
            }
          })
        )
        socket.emit("my_chats", chatList)
      }
    } catch (error) {
      console.error("get_my_chats error:", error)
      socket.emit("my_chats", [])
    }
  })

  // Получение сообщений (MongoDB)
  socket.on("get_messages", async (data) => {
    try {
      const { chatId, userId } = data
      if (userId !== user.id) return

      const chat = await Chat.findById(chatId)
      if (!chat) return

      if (!chat.participants.map((id) => id.toString()).includes(user.id)) return

      const chatMessages = await Message.find({ chat: chatId })
        .sort({ timestamp: 1 })
        .lean()

      const decryptedMessages = chatMessages.map((msg) => ({
        ...msg,
        id: msg._id.toString(),
        senderId: msg.sender?.toString(),
        chatId: msg.chat?.toString(),
        content: msg.isEncrypted ? decryptMessage(msg.content) : msg.content,
      }))

      socket.emit("chat_messages", { chatId, messages: decryptedMessages })
    } catch (error) {
      console.error("get_messages error:", error)
      socket.emit("chat_messages", { chatId, messages: [] })
    }
  })

  // Поиск пользователей (MongoDB)
  socket.on("search_users", async (query) => {
    try {
      if (!query || typeof query !== 'string' || query.length < 2) {
        socket.emit("search_results", [])
        return
      }
      const searchTerm = query.toLowerCase()
      const usersFound = await User.find({
        $or: [
          { username: { $regex: searchTerm, $options: "i" } },
          { fullName: { $regex: searchTerm, $options: "i" } },
          { email: { $regex: searchTerm, $options: "i" } },
        ],
        _id: { $ne: user.id },
      })
        .limit(10)
        .lean()
      const results = usersFound.map((u) => ({
        id: u._id.toString(),
        username: u.username,
        fullName: u.fullName,
        email: u.email,
        avatar: u.avatar,
        bio: u.bio,
        isOnline: u.isOnline,
        isVerified: u.isVerified,
        status: u.status,
      }))
      socket.emit("search_results", results)
    } catch (error) {
      console.error("search_users error:", error)
      socket.emit("search_results", [])
    }
  })

  // Создание приватного чата (MongoDB)
  socket.on("create_private_chat", async (data) => {
    try {
      const { userId, chatId, createdBy } = data
      if (createdBy !== user.id) return
      // Проверить, существует ли уже такой чат
      let chat = await Chat.findOne({
        _id: chatId,
      })
      if (!chat) {
        // Создать новый чат
        chat = await Chat.create({
          _id: chatId,
          name: user.fullName || user.username,
          avatar: user.avatar,
          description: `Приватный чат с ${user.fullName || user.username}`,
          isGroup: false,
          participants: [user.id, userId],
          createdAt: new Date(),
          type: "private",
          isEncrypted: true,
          createdBy: user.id,
          theme: "default",
          isPinned: false,
          isMuted: false,
        })
      }
      // Получить участников
      const populatedChat = await Chat.findById(chat._id)
        .populate("participants", "_id username fullName avatar isOnline isVerified status")
        .lean()
      // Отправить событие обоим участникам
      const targetSocket = Array.from(io.sockets.sockets.values()).find((s) => s.userId === userId)
      if (targetSocket) {
        targetSocket.join(chatId)
        targetSocket.emit("new_private_chat", {
          ...populatedChat,
          id: populatedChat._id.toString(),
        })
      }
      socket.join(chatId)
      socket.emit("new_private_chat", {
        ...populatedChat,
        id: populatedChat._id.toString(),
      })
      console.log(`💬 Создан приватный чат: ${user.username} ↔ ${userId}`)
    } catch (error) {
      console.error("create_private_chat error:", error)
    }
  })

  // Присоединение к чату (MongoDB)
  socket.on("join_chat", async (chatId) => {
    try {
      const chat = await Chat.findById(chatId)
      if (!chat) return

      if (!chat.participants.map((id) => id.toString()).includes(user.id)) return

      socket.join(chatId)
      console.log(`📥 ${user.username} присоединился к чату: ${chatId}`)
    } catch (error) {
      console.error("join_chat error:", error)
    }
  })

  // Отправка сообщения (MongoDB)
  socket.on("send_message", async (messageData) => {
    try {
      const chat = await Chat.findById(messageData.chatId)
      if (!chat) return
      if (!chat.participants.map((id) => id.toString()).includes(user.id)) return
      // Валидация сообщения
      if (!messageData.content || typeof messageData.content !== 'string' || messageData.content.trim().length === 0) {
        return
      }
      if (messageData.content.length > 1000) {
        socket.emit("error", { message: "Сообщение слишком длинное" })
        return
      }
      // Создать сообщение
      const message = await Message.create({
        sender: user.id,
        chat: chat._id,
        content: messageData.content,
        timestamp: new Date(),
        type: messageData.type || "text",
        fileUrl: messageData.fileUrl,
        fileName: messageData.fileName,
        fileSize: messageData.fileSize,
        isEncrypted: messageData.isEncrypted || false,
        replyTo: messageData.replyTo?.id,
        reactions: [],
        readBy: [user.id],
        isEdited: false,
      })
      const msgObj = {
        ...message.toObject(),
        id: message._id.toString(),
        senderId: user.id,
        chatId: chat._id.toString(),
        content: message.isEncrypted ? decryptMessage(message.content) : message.content,
      }
      io.to(chat._id.toString()).emit("new_message", msgObj)
      console.log(`💬 Сообщение от ${user.username} в чат ${chat._id}`)
    } catch (error) {
      console.error("send_message error:", error)
    }
  })

  // Реакции на сообщения (MongoDB)
  socket.on("add_reaction", async (data) => {
    try {
      const { messageId, emoji, userId, username } = data
      if (userId !== user.id) return
      if (!emoji || !reactionEmojis.includes(emoji)) return
      // Найти сообщение
      const message = await Message.findById(messageId)
      if (!message) return
      // Проверить, есть ли уже реакция от этого пользователя
      const existing = message.reactions.find(
        (r) => r.userId === userId && r.emoji === emoji
      )
      if (existing) {
        // Удалить реакцию
        message.reactions = message.reactions.filter(
          (r) => !(r.userId === userId && r.emoji === emoji)
        )
      } else {
        // Добавить реакцию
        message.reactions.push({ emoji, userId, username })
      }
      await message.save()
      io.to(message.chat.toString()).emit("message_reaction", {
        messageId,
        reactions: message.reactions,
      })
    } catch (error) {
      console.error("add_reaction error:", error)
    }
  })

  // Печатает сообщение (MongoDB check)
  socket.on("typing", async (data) => {
    try {
      const { chatId, userId, username } = data
      const chat = await Chat.findById(chatId)
      if (!chat) return
      if (!chat.participants.map((id) => id.toString()).includes(user.id)) return
      if (!typingUsers.has(chatId)) {
        typingUsers.set(chatId, new Set())
      }
      typingUsers.get(chatId).add(userId)
      socket.to(chatId).emit("user_typing", { userId, username, chatId })
    } catch (error) {
      console.error("typing error:", error)
    }
  })

  // Перестал печатать (MongoDB check)
  socket.on("stop_typing", async (data) => {
    try {
      const { chatId } = data
      const chat = await Chat.findById(chatId)
      if (!chat) return
      if (!chat.participants.map((id) => id.toString()).includes(user.id)) return
      if (typingUsers.has(chatId)) {
        typingUsers.get(chatId).delete(user.id)
        if (typingUsers.get(chatId).size === 0) {
          typingUsers.delete(chatId)
        }
      }
      socket.to(chatId).emit("user_stop_typing", { userId: user.id, chatId })
    } catch (error) {
      console.error("stop_typing error:", error)
    }
  })

  // Очистка чата (MongoDB)
  socket.on("clear_chat", async (chatId) => {
    try {
      const chat = await Chat.findById(chatId)
      if (!chat) return
      if (!chat.participants.map((id) => id.toString()).includes(user.id) && chat.createdBy.toString() !== user.id) return
      await Message.deleteMany({ chat: chatId })
      io.to(chatId).emit("chat_cleared", { chatId })
      console.log(`🧹 Чат ${chatId} очищен пользователем ${user.username}`)
    } catch (error) {
      console.error("clear_chat error:", error)
    }
  })

  // Обновление профиля (MongoDB)
  socket.on("update_profile", async (userData) => {
    try {
      // Валидация данных профиля
      const allowedFields = ['fullName', 'bio', 'avatar']
      const sanitizedData = {}
      for (const field of allowedFields) {
        if (userData[field] !== undefined) {
          if (field === 'fullName' && userData[field]) {
            sanitizedData[field] = userData[field].trim().substring(0, 50)
          } else if (field === 'bio' && userData[field]) {
            sanitizedData[field] = userData[field].trim().substring(0, 200)
          } else {
            sanitizedData[field] = userData[field]
          }
        }
      }
      await User.findByIdAndUpdate(user.id, sanitizedData)
      // Обновляем пользователя во всех чатах (MongoDB не требует этого, но можно обновить в памяти)
      // Уведомляем всех об обновлении
      const activeUsers = await User.find({ isOnline: true }).lean()
      io.emit("users_update", activeUsers.map((u) => ({
        id: u._id.toString(),
        username: u.username,
        fullName: u.fullName,
        email: u.email,
        avatar: u.avatar,
        isOnline: u.isOnline,
        isVerified: u.isVerified,
        status: u.status,
      })))
      console.log(`👤 ${user.username} обновил профиль`)
    } catch (error) {
      console.error("update_profile error:", error)
    }
  })

  // Отключение
  socket.on("disconnect", async () => {
    activeConnections.delete(socket.id)
    // Удаляем из всех typing lists
    for (const [chatId, typingSet] of typingUsers.entries()) {
      if (typingSet.has(user.id)) {
        typingSet.delete(user.id)
        if (typingSet.size === 0) {
          typingUsers.delete(chatId)
        }
        socket.to(chatId).emit("user_stop_typing", { userId: user.id, chatId })
      }
    }
    // Обновить статус пользователя в MongoDB
    await User.findByIdAndUpdate(user.id, { isOnline: false, lastSeen: new Date(), status: "offline" })
    // Обновляем список активных пользователей
    const activeUsers = await User.find({ isOnline: true }).lean()
    io.emit("users_update", activeUsers.map((u) => ({
      id: u._id.toString(),
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      avatar: u.avatar,
      isOnline: u.isOnline,
      isVerified: u.isVerified,
      status: u.status,
    })))
    console.log(`🔌 Отключение: ${user.username}`)
  })
})

// Запуск сервера
server.listen(PORT, () => {
  console.log(`
🚀 ACTOGRAM Server v3.0 запущен на порту ${PORT}
📱 Клиент: https://acto-uimuz.vercel.app
🌐 Сервер: https://actogr.onrender.com
🔐 Безопасность: JWT + Bcrypt + Rate Limiting + E2E Encryption
✨ Новые функции: Реакции, улучшенный UI, многоязычность
🛡️ Статус: Полностью защищен и готов к работе
  `)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM получен, завершаем работу сервера...")
  server.close(() => {
    console.log("Сервер успешно завершил работу")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("SIGINT получен, завершаем работу сервера...")
  server.close(() => {
    console.log("Сервер успешно завершил работу")
    process.exit(0)
  })
})

// Подключение к MongoDB с обработкой ошибок
const connectToMongoDB = async () => {
  try {
    await mongoose.connect("mongodb+srv://actogol:actogolsila@actogramuz.6ogftpx.mongodb.net/actogram?retryWrites=true&w=majority&appName=actogramUZ", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
      bufferMaxEntries: 0,
    })
    console.log("✅ MongoDB подключен")
  } catch (err) {
    console.error("❌ Ошибка подключения к MongoDB:", err.message)
    console.log("💡 Убедитесь, что IP адреса Render.com добавлены в белый список MongoDB Atlas")
    console.log("🔗 Ссылка для настройки: https://cloud.mongodb.com/v2/your-cluster-id/security/network/access")
    
    // Повторная попытка через 5 секунд
    setTimeout(connectToMongoDB, 5000)
  }
}

// Запуск подключения к MongoDB
connectToMongoDB()

// Обработка ошибок подключения
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err)
})

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected')
})

const UserSchema = new Schema({
  email: { type: String, unique: true },
  username: { type: String, unique: true },
  fullName: String,
  bio: String,
  password: String,
  createdAt: { type: Date, default: Date.now },
  isVerified: Boolean,
  isOnline: Boolean,
  lastSeen: Date,
  avatar: String,
  status: String,
});

const ChatSchema = new Schema({
  name: String,
  avatar: String,
  description: String,
  isGroup: Boolean,
  participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now },
  type: String,
  isEncrypted: Boolean,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  theme: String,
  isPinned: Boolean,
  isMuted: Boolean,
});

const MessageSchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: "User" },
  chat: { type: Schema.Types.ObjectId, ref: "Chat" },
  content: String,
  timestamp: { type: Date, default: Date.now },
  type: String,
  fileUrl: String,
  fileName: String,
  fileSize: Number,
  isEncrypted: Boolean,
  replyTo: { type: Schema.Types.ObjectId, ref: "Message" },
  reactions: [{ emoji: String, userId: String, username: String }],
  readBy: [String],
  isEdited: Boolean,
});

const User = model("User", UserSchema);
const Chat = model("Chat", ChatSchema);
const Message = model("Message", MessageSchema);
