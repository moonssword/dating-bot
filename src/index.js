import 'dotenv/config';
import i18n from 'i18n';
import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import { getFromLocation, getFromCityName } from './locationHandler.js';
import { handleBirthday } from './birthdayHandler.js';
import { handlePhoto } from './checkPhotoHandler.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { BUTTONS } from './constants.js';

// Подключение к базе данных MongoDB
mongoose.connect('mongodb://localhost:27017/userdata')
.then(() => console.log('Connected to MongoDB'))
.catch((error) => console.error('Connection to MongoDB failed:', error));

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

i18n.configure({
  locales: ['en', 'ru'], // Доступные языки
  directory: `${__dirname}/locales`, // Путь к файлам перевода
//  defaultLocale: 'ru', // Язык по умолчанию
  objectNotation: true, // Использование объектной нотации для строк
});

const locationDataMap = new Map(); // Создаем Map для временного хранения данных о местоположении

// Схема пользователя
const userSchema = new mongoose.Schema({
  telegramId: Number,
  userName: String,
  firstName: String,
  lastName: String,
  languageCode: String,
  globalUserState: String,
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
const User = mongoose.model('User', userSchema, 'users');

// Схема профиля
const profileSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  telegramId: Number,
  profileName: String,
  gender: String,
  birthday: Date,
  age: Number,
  interests: String,
  aboutMe: String,
  preferences: {
    preferredGender: String,
    ageRange: {
      min: Number,
      max: Number,
    },
  },
  profilePhoto: {
    photoId: mongoose.Schema.Types.ObjectId,
    photoPath: String,
    uploadDate: Date,
  },
  location: {
    locality: String,
    display_name: String,
    addresstype: String,
    state: String,
    country: String,
    latitude: Number,
    longitude: Number,
  },
}, { versionKey: false });

// Модель профиля
const Profile = mongoose.model('Profile', profileSchema, 'profiles');

//Схема фотографий профиля
const userPhotoSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  photos: [{
    filename: String,
    path: String,
    size: Number,
    uploadDate: { type: Date, default: Date.now },
    verifiedPhoto: { type: Boolean, default: false },
  }]
}, { versionKey: false });

//Модель фотографий профиля
const UserPhoto = mongoose.model('UserPhoto', userPhotoSchema, 'usersPhotos');

// Создание экземпляра бота
const bot = new TelegramBot(process.env.bot_token, { polling: true });

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  console.log(msg);
  const chatId = msg.chat.id;
  const userLanguage = msg.from.language_code;
  const userData = {
    telegramId: msg.from.id,
    userName: msg.from.username,
    firstName: msg.from.first_name,
    lastName: msg.from.last_name,
    languageCode: msg.from.language_code,
    isBot: msg.from.is_bot,
    globalUserState: 'new',
  };

  // Локализация текстов
  i18n.setLocale(userLanguage);

  try {
    // Найти пользователя по идентификатору
    const existingUser = await User.findOne({ telegramId: userData.telegramId });

    if (!existingUser) {
      // Если пользователя нет, создать нового
      const createdUser = await User.create(userData);
      console.log('User created:', createdUser);

      // Создать профиль для нового пользователя
      const profileData = {
        userId: createdUser._id,
        telegramId: createdUser.telegramId,
        profileName: createdUser.firstName,
        // Add other profile properties as needed
      };
      const createdProfile = await Profile.create(profileData);
      console.log('Profile created for the new user:', createdProfile);
    } else {
      console.log('User already exists:', existingUser);
    }
  } catch (err) {
    console.error('Error processing /start command:', err);
  }

  // Отправка сообщения с кнопкой "Регистрация"
  bot.sendMessage(chatId, i18n.__('registration_message'), {
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

const currentUserState = new Map(); // Переменная состояния регистрации(state)

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const existingUser = await User.findOne({ telegramId: userId });
  const userProfile = await Profile.findOne({ telegramId: userId });

  try {
    if ('registration' === data) {
      // Обработка нажатия на кнопку "Регистрация"
      bot.deleteMessage(chatId, messageId);
      bot.sendMessage(chatId, i18n.__('select_language_message'), {
        reply_markup: {
          inline_keyboard: [
            [ { text: i18n.__('select_english'), callback_data: 'select_language_en' }],
            [ { text: i18n.__('select_russian'), callback_data: 'select_language_ru' }],
          ],
        },
      });
      const updatedUser = await User.findOneAndUpdate(
        { telegramId: userId },
        { globalUserState: 'registration_process' }, // Set user state to 'registration_process'
        { new: true }
      );
      console.log('User state is "registration_process":', updatedUser);

    } else if ('select_language_en' === data || 'select_language_ru' === data) {
      // Обработка выбора языка
      const language = data === 'select_language_en' ? 'en' : 'ru';
      i18n.setLocale(language);

      const updatedUser = await User.findOneAndUpdate(
        { telegramId: userId },
        { languageCode: language },
        { new: true }
      );

      console.log('User language updated:', updatedUser);

      bot.deleteMessage(chatId, messageId);

        if (existingUser.globalUserState === 'registration_process') {
          bot.answerCallbackQuery( callbackQuery.id, {text: i18n.__('select_language_text'), show_alert: false} );
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
        } else if (existingUser.globalUserState === 'active') {
          const languageSelected = await bot.sendMessage(chatId, i18n.__('select_language_text'));
          setTimeout(async () => {
              try {
                  await bot.deleteMessage(chatId, languageSelected.message_id);
                  sendMyProfile(chatId, userProfile);
              } catch (error) {
                  console.error('Error:', error);
              }
          }, 2000);
          currentUserState.set(userId, 'my_profile');
          
        }

    } else if ('select_male' === data || 'select_female' === data) {
      // Обработка выбора пола
      const gender = data === 'select_male' ? 'male' : 'female';
      const genderText = gender === 'male' ? i18n.__('gender_selected_male') : i18n.__('gender_selected_female');

      const updatedProfile = await Profile.findOneAndUpdate(
        { telegramId: userId },
        { gender: gender },
        { new: true }
      );

      console.log('User gender updated:', updatedProfile);

      bot.answerCallbackQuery(callbackQuery.id, {text: genderText, show_alert: false} );
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
      currentUserState.set(userId, 'select_city');

    } else if (data.includes('locationId')) {
      // Обработка выбора города
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
            'location.addresstype': selectedCity.addresstype || '',
            'location.state': selectedCity.state || '',
            'location.country': selectedCity.country || selectedCity.display_name.split(', ')[selectedCity.display_name.split(', ').length - 1],
            'location.latitude': selectedCity.latitude,
            'location.longitude': selectedCity.longitude,
          },
          { new: true }
        );

        console.log('User location updated:', updatedProfile);

        bot.answerCallbackQuery(callbackQuery.id, {text: `${i18n.__('location_notification')} ${selectedCity.display_name}`, show_alert: false});
        bot.deleteMessage(chatId, messageId);

        bot.sendMessage(chatId, i18n.__('enter_birthday_message'), { reply_markup: { remove_keyboard: true } }) // Текст ввода даты рождения
        currentUserState.set(userId, 'enter_birthday');
      }
    } else if ('confirm_agreement_button' === data) {
      // Обработка нажатия кнопки "Продолжить" с соглашением
      currentUserState.set(userId, 'main_menu'); // Set user state to 'main_menu'
      const updatedUser = await User.findOneAndUpdate(
        { telegramId: userId },
        { globalUserState: 'active' }, // Set user state to 'active'
        { new: true }
      );
      console.log('User state is "active":', updatedUser);
      
      bot.sendMessage(chatId, i18n.__('main_menu_message'), {
        reply_markup: {
          keyboard: i18n.__('main_menu_buttons'),
          resize_keyboard: true
        }}
      )
    }
  } catch (err) {
    console.error('Ошибка:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при обработке колбэк-данных.');
  }
});


bot.on('message', async (msg) => {  // Обработчик сообщений от пользователя
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const locationMessage = msg.location;
  const cityName = msg.text;

  // Получаем текущее состояние пользователя
  try {
    // Найти пользователя по идентификатору
    const existingUser = await User.findOne({ telegramId: userId });
    const userProfile = await Profile.findOne({ telegramId: userId });

    if (existingUser && existingUser.globalUserState === 'registration_process') {
      const currentState = currentUserState.get(userId);
      switch (currentState) {
        case 'select_city':   // Обработка полученной локации или названия города
          if (locationMessage) {
            // Если получена локация, обработать её
            try {
              const { locality, display_name, addresstype, state, country } = await getFromLocation(userId, locationMessage, bot);
              // Обновление профиля пользователя с полученным местоположением
              const updatedProfile = await Profile.findOneAndUpdate(
                { telegramId: userId },
                {
                  'location.locality': locality || '',
                  'location.display_name': display_name || '',
                  'location.addresstype': addresstype || '',
                  'location.state': state || '',
                  'location.country': country || '',
                  'location.latitude': locationMessage.latitude,
                  'location.longitude': locationMessage.longitude,
                },
                { new: true }
              );
              console.log('User location updated:', updatedProfile);

              const savedMessage = await bot.sendMessage(chatId, `${i18n.__('location_notification')} ${locality}, ${country}`, { reply_markup: { remove_keyboard: true } });
              setTimeout(async () => {
                try {
                  await bot.deleteMessage(chatId, savedMessage.message_id);
                  await bot.sendMessage(chatId, i18n.__('enter_birthday_message'));
                } catch (error) {
                  console.error('Error:', error);
                }
              }, 3000);

              currentUserState.set(userId, 'enter_birthday');

            } catch (err) {
              console.error('Error updating user location:', err);
            }
          } else if(cityName) {
            // Если получено сообщение с текстом (название города), обработать его
            await getFromCityName(cityName, bot, chatId, locationDataMap);
          }
          break;
        case 'enter_birthday':  // Обработка ввода даты рождения
          await handleBirthday(bot, currentUserState, User, Profile, i18n, msg);
          break;
        case 'select_photo':  // Обработка отправленной фотографии 
          await handlePhoto(bot, currentUserState, i18n, msg, User, UserPhoto, Profile);
          break;
        //default:
      }
    } else if (existingUser && existingUser.globalUserState === 'active') {
      const currentState = currentUserState.get(userId);
      switch (currentState) {
        case 'main_menu':
          if (msg.text === BUTTONS.SETTINGS.en || msg.text === BUTTONS.SETTINGS.ru) {
            currentUserState.set(userId, 'settings_menu');
            bot.sendMessage(chatId, i18n.__('settings_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('settings_menu_buttons'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.PROFILES.en || msg.text === BUTTONS.PROFILES.ru) {
            currentUserState.set(userId, 'user_profiles');
            bot.sendAnimation(chatId, 'https://gifki.su/Uploads/Media/Nov22/Sun13/1455/9cc1a47.gif', {
              caption: i18n.__('user_profiles_message'),
              reply_markup: {
                keyboard: i18n.__('user_profiles_buttons'),
                resize_keyboard: true,
              },
              protect_content: true,
            });
          } //далее условия для 2 оставшихся пунктов меню
          break;
        case 'settings_menu':
          if (msg.text === BUTTONS.MY_PROFILE.en || msg.text === BUTTONS.MY_PROFILE.ru) {
            currentUserState.set(userId, 'my_profile');
            sendMyProfile(chatId, userProfile);
          } else if (msg.text === BUTTONS.SEARCH_SETTINGS.en || msg.text === BUTTONS.SEARCH_SETTINGS.ru) {
            currentUserState.set(userId, 'search_settings');
            bot.sendMessage(chatId, i18n.__('search_settings_message'), {
              reply_markup: {
                keyboard: i18n.__('search_settings_buttons'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              }});
          }
          break;
        case 'user_profiles':
          //Обработка анкет
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              }});
          }
          break;
        case 'search_settings':
          //Настройка поиска анкет
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'settings_menu');
            bot.sendMessage(chatId, i18n.__('settings_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('settings_menu_buttons'),
                resize_keyboard: true
              }});
          }
          break;
        case 'my_profile':
          //Обработка выбора меню Мой профиль
          if (msg.text === BUTTONS.NAME.en || msg.text === BUTTONS.NAME.ru) {
            currentUserState.set(userId, 'enter_profilename');
            bot.sendMessage(chatId, i18n.__('enter_profilename_message'), {
              reply_markup: {
                keyboard: i18n.__('back_button'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'settings_menu');
            bot.sendMessage(chatId, i18n.__('settings_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('settings_menu_buttons'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.DATE_OF_BIRTH.en || msg.text === BUTTONS.DATE_OF_BIRTH.ru) {
            currentUserState.set(userId, 'enter_birthday');
            bot.sendMessage(chatId, i18n.__('enter_birthday_message'), {
              reply_markup: {
                keyboard: i18n.__('back_button'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.ABOUT_ME.en || msg.text === BUTTONS.ABOUT_ME.ru) {
            currentUserState.set(userId, 'enter_aboutme');
            bot.sendMessage(chatId, i18n.__('enter_aboutme_message'), {
              reply_markup: {
                keyboard: i18n.__('back_button'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.INTERFACE_LANGUAGE.en || msg.text === BUTTONS.INTERFACE_LANGUAGE.ru) {
            currentUserState.set(userId, 'select_language');
            bot.sendMessage(chatId, i18n.__('select_language_message'), {
              reply_markup: {
                inline_keyboard: [
                  [ { text: i18n.__('select_english'), callback_data: 'select_language_en' }],
                  [ { text: i18n.__('select_russian'), callback_data: 'select_language_ru' }],
                ],
              },
            });
          } else if (msg.text === BUTTONS.PHOTO.en || msg.text === BUTTONS.PHOTO.ru) {
            currentUserState.set(userId, 'select_photo');
            bot.sendMessage(chatId, i18n.__('request_photo_message_text'), {
              reply_markup: {
                keyboard: i18n.__('back_button'),
                resize_keyboard: true
              }});
          }
          break;
        case 'enter_profilename':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'my_profile');
            sendMyProfile(chatId, userProfile);
          } else {
            const updatedProfile = await Profile.findOneAndUpdate(
              { telegramId: userId },
              { profileName: msg.text },
              { new: true }
            );
            console.log('User profileName updated:', updatedProfile);
        
            currentUserState.set(userId, 'my_profile');
            sendMyUpdatedProfile(chatId, updatedProfile);
          }
          break;
        case 'enter_birthday':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'my_profile');
            sendMyProfile(chatId, userProfile);
          } else {
            await handleBirthday(bot, currentUserState, User, Profile, i18n, msg);
          }
          break;
        case 'enter_aboutme':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'my_profile');
            sendMyProfile(chatId, userProfile);
          } else {
            const updatedProfile = await Profile.findOneAndUpdate(
              { telegramId: userId },
              { aboutMe: msg.text },
              { new: true }
            );
            console.log('User aboutMe updated:', updatedProfile);
        
            // Вернитесь к предыдущему состоянию, например, 'my_profile'
            currentUserState.set(userId, 'my_profile');
            sendMyUpdatedProfile(chatId, updatedProfile);
          }
          break;
        case 'select_language':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'my_profile');
            sendMyProfile(chatId, userProfile);
          }
          break;
        case 'select_photo':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'my_profile');
            sendMyProfile(chatId, userProfile);
          } else {
            await handlePhoto(bot, currentUserState, i18n, msg, User, UserPhoto, Profile);
          }
          break;
        case undefined:  //на время отладки меню
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              }});
          break;
      }
    }
  } catch (err) {
    console.error('Error retrieving user state:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при обработке сообщения.');
  }
});

function sendMyProfile(chatId, userProfile) {
  bot.sendPhoto(chatId, userProfile.profilePhoto.photoPath, {
    caption: `${userProfile.profileName}, ${userProfile.age}\n 🌍${userProfile.location.locality}, ${userProfile.location.country}\n${i18n.__('myprofile_gender_message')} ${userProfile.gender}\n 〰️〰️〰️〰️〰️〰️〰️〰️\n<i>${userProfile.aboutMe}</i>`,
    reply_markup: {
      keyboard: i18n.__('myprofile_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
    protect_content: true,
  });
}

function sendMyUpdatedProfile(chatId, updatedProfile) {
  bot.sendPhoto(chatId, updatedProfile.profilePhoto.photoPath, {
    caption: `${updatedProfile.profileName}, ${updatedProfile.age}\n 🌍${updatedProfile.location.locality}, ${updatedProfile.location.country}\n${i18n.__('myprofile_gender_message')} ${updatedProfile.gender}\n 〰️〰️〰️〰️〰️〰️〰️〰️\n<i>${updatedProfile.aboutMe}</i>`,
    reply_markup: {
      keyboard: i18n.__('myprofile_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
    protect_content: true,
  });
}