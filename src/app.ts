import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid' // для генерации уникальных токенов

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

// Миддлварь для парсинга JSON в теле запросов и куки
app.use(
  cors({
    origin: 'https://wanderhappen.github.io', // Укажите URL вашего клиентского приложения
    methods: ['GET', 'POST'],
    credentials: true, // Разрешить использование cookie
  })
)

app.use(express.json())
app.use(cookieParser()) // Подключаем cookie-parser для работы с куки

// Определение типов
export type UserType = {
  userid: string
  name: string
}

export type ServerMessageType = {
  message: string
  messageId: string
  user: UserType
}

// Функция для генерации случайного ID
function generateRandomId(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Функция для генерации уникальных токенов
function generateToken(): string {
  return uuidv4()
}

// Хранилище для пользователей
const users = new Map<string, UserType>()

// Роут для авторизации
app.post('/auth', (req, res) => {
  console.log('Кто-то пытается авторизоваться')

  // Получаем токен из куки
  const token = req.cookies.token
  console.log(token)

  // Проверяем, есть ли такой токен в базе пользователей
  if (token && users.has(token)) {
    const user = users.get(token)
    console.log(user?.name, 'Он авторизован')
    return res.status(200).json({
      message: 'Авторизация успешна',
      user, // Возвращаем данные пользователя
      token, // Возвращаем токен, если это нужно на фронте
    })
  }

  // Если токен не найден, возвращаем ошибку 401 (Unauthorized)
  return res.status(401).json({
    message: 'Неверный токен или пользователь не авторизован',
  })
})

// Роут для регистрации (создание нового пользователя)
// Роут для регистрации (создание нового пользователя)
app.post('/register', (req, res) => {
  const { name } = req.body // Получаем имя из тела запроса
  console.log(name, 'регистрируется')

  // Если имя не указано, возвращаем ошибку
  if (!name) {
    return res
      .status(400)
      .json({ message: 'Имя пользователя обязательно для регистрации' })
  }

  // Генерируем новый ID пользователя и токен
  const userId = generateRandomId()
  const newToken = generateToken()

  // Создаем нового пользователя
  const newUser: UserType = { userid: userId, name }

  // Сохраняем пользователя и токен
  users.set(newToken, newUser)

  // Устанавливаем токен в куки на 30 дней
  res.cookie('token', newToken, {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
    httpOnly: true, // Куки доступны только через HTTP (нельзя получить через JS)
    secure: false, // Включите true, когда будете использовать HTTPS
    sameSite: 'lax',
  })

  // Возвращаем данные нового пользователя и токен
  return res.status(201).json({
    message: 'Регистрация успешна1',
    user: newUser,
    token: newToken, // Возвращаем токен
  })
})

// Роут для выхода (удаление токена)
app.post('/logout', (req, res) => {
  res.clearCookie('token') // Удаляем токен из куки
  return res.status(200).json({ message: 'Вы вышли из системы' })
})

// Хранилище для сообщений (в памяти)
const messages: ServerMessageType[] = []
let connectedUsersCount = 0

// WebSocket соединение
io.on('connection', (socket) => {
  connectedUsersCount++
  console.log('Пользователь подключен')
  console.log(
    'Пользователь подключен, всего пользователей:',
    connectedUsersCount
  )

  io.emit('users-count', connectedUsersCount)

  // Когда пользователь отправляет сообщение
  socket.on(
    'client-message-sent',
    ({ text, token }: { text: string; token: string }) => {
      console.log('Полученный токен:', token) // Логируем полученный токен
      const user = users.get(token)
      console.log('Пользователь:', user) // Логируем пользователя
      if (user) {
        const message: ServerMessageType = {
          message: text, // Сообщение от клиента
          messageId: uuidv4(), // Уникальный ID для сообщения
          user: {
            userid: user.userid, // ID пользователя
            name: user.name,
          },
        }
        messages.push(message)
        socket.emit('all-messages', messages)

        socket.broadcast.emit('new-message', message) // Отправляем всем клиентам новое сообщение
      }
    }
  )

  // Когда пользователя печатает
  socket.on('client-typing', (token: string) => {
    const user = users.get(token)

    if (user) {
      const name = user.name
      socket.broadcast.emit('notify-typing', name) // Уведомляем всех клиентов
    }
  })

  // Отправка всех сообщений новому подключившемуся клиенту
  socket.emit('all-messages', messages)
  console.log('messages: ', messages)

  // Когда клиент редактирует сообщение
  socket.on('message-update', ({ messageId, newMessage }) => {
    console.log('Редактирование сообщения:', newMessage)
    const message = messages.find((msg) => msg.messageId === messageId)
    if (message) {
      message.message = newMessage // Обновляем сообщение
      io.emit('message-updated', { messageId, message }) // Уведомляем всех клиентов
    }
  })

  // Когда клиент удаляет сообщение
  socket.on('message-delete', (messageId: string) => {
    const index = messages.findIndex((msg) => msg.messageId === messageId)
    if (index !== -1) {
      messages.splice(index, 1) // Удаляем сообщение
      io.emit('message-deleted', messageId) // Уведомляем всех клиентов
    }
  })

  // Обработка отключения пользователя
  socket.on('disconnect', () => {
    connectedUsersCount-- // Уменьшаем количество подключенных пользователей
    console.log(
      'Пользователь отключен, всего пользователей:',
      connectedUsersCount
    )

    // Отправляем обновлённое количество подключенных пользователей всем клиентам
    io.emit('users-count', connectedUsersCount)
  })
})

// Запуск сервера
const port = 3009
server.listen(port, () => {
  console.log(`Сервер запущен на порту *:${port}`)
})
