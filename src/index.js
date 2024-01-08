require('dotenv').config();
const i18n = require('i18n');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const {   getFromLocation, getFromCityName } = require('./locationModule');

// Подключение к базе данных MongoDB
mongoose.connect('mongodb://localhost:27017/userdata', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch((error) => console.error('Connection to MongoDB failed:', error));

i18n.configure({
  locales: ['en', 'ru'], // Доступные языки
  directory: __dirname + '/locales', // Путь к файлам перевода
  defaultLocale: 'ru', // Язык по умолчанию
  objectNotation: true, // Использование объектной нотации для строк
});

const locationDataMap = new Map(); // Создаем Map для временного хранения данных о местоположении

// Функция для генерации уникальных идентификаторов
function generateUniqueID() {
return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Схема пользователя
const userSchema = new mongoose.Schema({
  telegramId: Number,
  userName: String,
  firstName: String,
  lastName: String,
  languageCode: String,
  isBot: Boolean,
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

// Хук для автоматической установки значения createdAt при создании нового пользователя
userSchema.pre('save', function(next) {
  if (!this.createdAt) {
    this.createdAt = new Date();
  }
  next();
});

// Модель пользователя
const User = mongoose.model('User', userSchema);

// Схема профиля
const profileSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  telegramId: Number,
  gender: String,
  birthday: Date,
  interests: String,
  location: {
    locality: String,
    display_name: String,
    type: String,
    state: String,
    country: String,
    latitude: Number,
    longitude: Number,
  },
}, { versionKey: false });

// Модель профиля
const Profile = mongoose.model('Profile', profileSchema);

// Создание экземпляра бота
const bot = new TelegramBot(process.env.bot_token, { polling: true });

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userLanguage = msg.from.language_code;
  const userData = {
    telegramId: msg.from.id,
    userName: msg.from.username,
    firstName: msg.from.first_name,
    lastName: msg.from.last_name,
    languageCode: msg.from.language_code,
    isBot: msg.from.is_bot,
  };

  // Локализация текстов
  i18n.setLocale(userLanguage);

  try {
    // Найти пользователя по идентификатору и обновить его данные или создать нового
    const options = { upsert: true, new: true, setDefaultsOnInsert: true };
    const updatedUser = await User.findOneAndUpdate(
      { telegramId: userData.telegramId },
      userData,
      options
    );
    console.log('User updated:', updatedUser);

    // Создать профиль для пользователя
    const existingProfile = await Profile.findOne({ userId: updatedUser.id });

    if (!existingProfile) {
      // Создать профиль для пользователя, если его нет
      const profileData = {
        userId: updatedUser._id,
        telegramId: updatedUser.telegramId,
        // Add other profile properties as needed
      };
      const createdProfile = await Profile.create(profileData);
      console.log('Profile created:', createdProfile);
    } else {
      console.log('Profile already exists for the user.');
    }
  } catch (err) {
    console.error('Error updating user:', err);
  }

  // Отправка сообщения с кнопкой "Регистрация"
  bot.sendMessage(chatId, i18n.__('welcome_message'), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: i18n.__('registration_button'),
            callback_data: 'registration',
          },
        ],
      ],
    },
    parse_mode: 'HTML', // Установка типа парсинга сообщения
  });
});

bot.on('callback_query', async (callbackQuery) => { // Обработка нажатия на кнопку "Регистрация"
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  try {
    if (data === 'registration') {
      // Обработка нажатия на кнопку "Регистрация"
      bot.deleteMessage(chatId, messageId);
      bot.sendMessage(chatId, i18n.__('choose_language'), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: i18n.__('select_english'), callback_data: 'select_language_en' },
              { text: i18n.__('select_russian'), callback_data: 'select_language_ru' },
            ],
          ],
        },
      });
    } else if (data === 'select_language_en' || data === 'select_language_ru') {        // Обработка выбора языка
      const language = data === 'select_language_en' ? 'en' : 'ru';
      i18n.setLocale(language);
      const languageText = i18n.__('select_language_text');

      const updatedUser = await User.findOneAndUpdate(
        { telegramId: userId },
        { languageCode: language },
        { new: true }
      );

      console.log('User language updated:', updatedUser);

      bot.answerCallbackQuery(callbackQuery.id, languageText);
      bot.deleteMessage(chatId, messageId);

      bot.sendMessage(chatId, i18n.__('select_gender'), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: i18n.__('select_male'), callback_data: 'select_male' },
              { text: i18n.__('select_female'), callback_data: 'select_female' },
            ],
          ],
        },
      });
    } else if (data === 'select_male' || data === 'select_female') {        // Обработка выбора пола
      const gender = data === 'select_male' ? 'male' : 'female';
      const genderText = gender === 'male' ? i18n.__('gender_selected_male') : i18n.__('gender_selected_female');

      const updatedProfile = await Profile.findOneAndUpdate(
        { telegramId: userId },
        { gender: gender },
        { new: true }
      );

      console.log('User gender updated:', updatedProfile);

      bot.answerCallbackQuery(callbackQuery.id, genderText);
      bot.deleteMessage(chatId, messageId);

      bot.sendMessage(chatId, i18n.__('request_location_or_city'), {
        reply_markup: {
          keyboard: [
            [
              { text: i18n.__('send_location'), request_location: true },
            ],
          ],
          resize_keyboard: true,
        },
      });
    } else {        // Обработка выбора города из списка или других дополнительных действий
      const parsedData = JSON.parse(data);

      if (parsedData) {
        const { locationId, cityIndex } = parsedData;
        const locationData = locationDataMap.get(locationId);

        if (!locationData || locationData.length <= cityIndex) {
          bot.sendMessage(chatId, 'Произошла ошибка, город не найден.');
          return;
        }

        const selectedCity = locationData[cityIndex];

        const updatedProfile = await Profile.findOneAndUpdate(
          { telegramId: userId },
          {
            'location.locality': selectedCity.locality || '',
            'location.display_name': selectedCity.display_name || '',
            'location.type': selectedCity.type || '',
            'location.state': selectedCity.state || '',
            'location.country': selectedCity.country || '',
            'location.latitude': selectedCity.latitude,
            'location.longitude': selectedCity.longitude,
          },
          { new: true }
        );

        console.log('User location updated:', updatedProfile);

        bot.answerCallbackQuery(callbackQuery.id, `Выбран город: ${selectedCity.display_name}`);
        bot.deleteMessage(chatId, messageId);
      }
    }
  } catch (err) {
    console.error('Ошибка:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при обработке колбэк-данных.');
  }
});

bot.on('message', async (msg) => {  // Обработка полученной локации или названия города
  const userId = msg.from.id;
  const locationMessage = msg.location;
  const cityName = msg.text;
  const chatId = msg.chat.id;

  if (locationMessage) {
    // Если получена локация, обработать её
    try {
      const { locality, type, state, country } = await getFromLocation(userId, locationMessage, bot);

      // Обновление профиля пользователя с полученным местоположением
      const updatedProfile = await Profile.findOneAndUpdate(
        { telegramId: userId },
        {
          'location.locality': locality,
          'location.type': type,
          'location.state': state,
          'location.country': country,
          'location.latitude': locationMessage.latitude,
          'location.longitude': locationMessage.longitude,
        },
        { new: true }
      );

      console.log('User location updated:', updatedProfile);

      // Здесь можно вызвать внешний модуль для дальнейшей обработки местоположения
      // externalModule.processLocation(updatedProfile);
    } catch (err) {
      console.error('Error updating user location:', err);
    }
  } else if(cityName) {
    // Если получено сообщение с текстом (название города), обработать его
    await getFromCityName(cityName, bot, chatId, locationDataMap);
  }
});

/*bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  try {
    const { locationId, cityIndex } = JSON.parse(data); // Извлекаем cityIndex
    const locationData = locationDataMap.get(locationId); // Получаем данные о местоположении

    if (!locationData || locationData.length <= cityIndex) {
      bot.sendMessage(chatId, 'Произошла ошибка, город не найден.');
      return;
    }

    const selectedCity = locationData[cityIndex]; // Получаем данные выбранного города
    const userId = callbackQuery.from.id;

    // Обновляем профиль пользователя с выбранным городом
    const updatedProfile = await Profile.findOneAndUpdate(
      { telegramId: userId },
      {
        'location.locality': selectedCity.locality || '',
        'location.display_name': selectedCity.display_name || '',
        'location.type': selectedCity.type || '',
        'location.state': selectedCity.state || '',
        'location.country': selectedCity.country || '',
        'location.latitude': selectedCity.latitude,
        'location.longitude': selectedCity.longitude,
      },
      { new: true }
    );

    console.log('User location updated:', updatedProfile);

    // Отправляем уведомление о выборе города
    bot.answerCallbackQuery(callbackQuery.id, `Выбран город: ${selectedCity.display_name}`);

    // Опционально, удаляем сообщение с кнопками выбора города
    bot.deleteMessage(chatId, callbackQuery.message.message_id);

  } catch (err) {
    console.error('Ошибка:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при обработке колбэк-данных.');
  }
});*/