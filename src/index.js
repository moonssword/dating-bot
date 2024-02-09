import 'dotenv/config';
import i18n from 'i18n';
import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import { getFromLocation, getFromCityName, calculateAndReturnDistance } from './locationHandler.js';
import { handleBirthday } from './birthdayHandler.js';
import { handlePhoto } from './photoHandler.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { BUTTONS } from './constants.js';
import moment from 'moment';

process.env.NTBA_FIX_319 = 1;
process.env.NTBA_FIX_350 = 0;

// Подключение к базе данных MongoDB
mongoose.connect('mongodb://localhost:27017/userdata')
.then(() => console.log('Connected to MongoDB'))
.catch((error) => console.error('Connection to MongoDB failed:', error));

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const locationDataMap = new Map(); // Создаем Map для временного хранения данных о местоположении
const currentUserState = new Map(); // Переменная состояния регистрации(state)

i18n.configure({
  locales: ['en', 'ru'], // Доступные языки
  directory: `${__dirname}/locales`, // Путь к файлам перевода
//  defaultLocale: 'ru', // Язык по умолчанию
  objectNotation: true, // Использование объектной нотации для строк
});

// Схема пользователя
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, int64: true },
  userName: String,
  firstName: String,
  lastName: String,
  languageCode: String,
  globalUserState: String,
  isBot: Boolean,
}, { versionKey: false, timestamps: true  });
// Модель пользователя
userSchema.index({ telegramId: 1 }, { unique: true });
const User = mongoose.model('User', userSchema, 'users');

// Схема профиля
const profileSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  telegramId: { type: Number, int64: true },
  userName: String,
  profileName: String,
  gender: String,
  birthday: Number,
  age: Number,
  interests: String,
  aboutMe: String,
  lastActivity: Number,
  preferences: {
    preferredGender: String,
    ageRange: {
      min: Number,
      max: Number,
    },
    preferredLocation: {
      locality: String,
      country: String,
    },
  },
  profilePhoto: {
    photo_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserPhoto',
    },
    photoPath: String,
    photoBlurredPath: String,
    uploadDate: Date,
  },
  location: {
    locality: String,
    display_name: String,
    addresstype: String,
    state: String,
    country: String,
    sentGeolocation: Boolean,
    latitude: Number, //location: { type: "Point", coordinates: [longitude, latitude] }, В дальнейшем для указания расстояния до кандидата
    longitude: Number,
  },
  likedProfiles: [{
    type: Number,
    ref: 'Profile',
    int64: true,
  }],
  dislikedProfiles: [{
    type: Number,
    ref: 'Profile',
    int64: true,
  }],
  matches: [{
    type: Number,
    ref: 'Profile',
    int64: true,
  }],
  viewingMatchIndex: Number,
  viewingLikesYouIndex: Number,
}, { versionKey: false, timestamps: true  });
// Модель профиля
profileSchema.index({ telegramId: 1 }, { unique: true });
const Profile = mongoose.model('Profile', profileSchema, 'profiles');

//Схема фотографий профиля
const userPhotoSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  photos: [{
    filename: String,
    path: String,
    blurredPath: String,
    size: Number,
    uploadDate: { type: Date, default: Date.now },
    verifiedPhoto: { type: Boolean, default: false },
  }]
}, { versionKey: false, timestamps: true  });
//Модель фотографий профиля
const UserPhoto = mongoose.model('UserPhoto', userPhotoSchema, 'usersPhotos');

const subscriptionsSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  telegramId: { type: Number, int64: true },
  subscriptionType: {
    type: String,
    enum: ['basic', 'plus', 'premium'],
    default: 'basic',
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  endDate: {
    type: Date,
    required: function() {
      return this.subscriptionType !== 'basic';
    }
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'not_required'],
    default: function() {
      return this.subscriptionType === 'basic' ? 'not_required' : 'pending';
    }
  },
  features: {
    unlimitedLikes: {
      type: Boolean,
      default: true,
    },
    seeWhoLikesYou: {
      type: Boolean,
      default: false,
    },
    additionalSearchFilters: {
      type: Boolean,
      default: false,
    },
    adFree: {
      type: Boolean,
      default: false,
    },
  },
}, { versionKey: false, timestamps: true });
subscriptionsSchema.index({ telegramId: 1 }, { unique: true });
const Subscriptions = mongoose.model('Subscriptions', subscriptionsSchema, 'subscriptions');

const bot = new TelegramBot(process.env.bot_token, { polling: true });

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
        user_id: createdUser._id,
        telegramId: createdUser.telegramId,
        profileName: createdUser.firstName,
        userName: createdUser.userName,
        // Add other profile properties as needed
      };
      const createdProfile = await Profile.create(profileData);
      console.log('Profile created for the new user:', createdProfile);

      const userPhotoData = {
        user_id: createdUser._id,
        telegramId: createdUser.telegramId,
      };
      const createdUserPhoto = await UserPhoto.create(userPhotoData);
      console.log('UserPhoto collection created for the new user:', createdUserPhoto);

      const initialSubscriptionData = {
        user_id: createdUser._id,
        telegramId: createdUser.telegramId,
        subscriptionType: 'basic',
        startDate: new Date(),
        // endDate не требуется для базовой подписки, определяется условием в схеме
        isActive: true,
        paymentStatus: 'not_required',
        features: {
          unlimitedLikes: true,
          seeWhoLikesYou: false,
          additionalSearchFilters: false,
          adFree: false,
        },
      };
      try {
        const createdSubscription = await Subscriptions.create(initialSubscriptionData);
        console.log('Initial subscription created for the new user:', createdSubscription);
      } catch (error) {
        console.error('Error creating initial subscription for the new user:', error);
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

    } else {
      console.log('User already exists:', existingUser);
    }
  } catch (err) {
    console.error('Error processing /start command:', err);
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const existingUser = await User.findOne({ telegramId: userId });
  const userProfile = await Profile.findOne({ telegramId: userId });
  await updateUserLastActivity(userId);
  const buttonsViewMatches = ['previous_match_button', 'next_match_button', 'first_match_button', 'last_match_button', 'delete_match_button']; //Обработчик совпадений

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
          bot.sendMessage(chatId, i18n.__('select_gender_message'), {
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

          bot.answerCallbackQuery(callbackQuery.id, {text: i18n.__('select_language_text'), show_alert: false} );
          console.log('User language updated:', updatedUser);
    
          currentUserState.set(userId, 'settings_menu');
          await bot.sendMessage(chatId, i18n.__('settings_menu_message'), {
            reply_markup: {
              keyboard: i18n.__('settings_menu_buttons'),
              resize_keyboard: true
            }});          
        }

    } else if ('select_male' === data || 'select_female' === data) {
      // Обработка выбора пола
      const gender = data === 'select_male' ? 'male' : 'female';
      const genderText = gender === 'male' ? i18n.__('gender_selected_male') : i18n.__('gender_selected_female');
      const preferenceGenderText = gender === 'male' ? i18n.__('preference_gender_selected_male') : i18n.__('preference_gender_selected_female');

        if (existingUser.globalUserState === 'registration_process') {
          const updatedProfile = await Profile.findOneAndUpdate(
            { telegramId: userId },
            { gender: gender,
              'preferences.preferredGender': gender === 'male' ? 'female' : 'male' ,
            },
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

        } else if (existingUser.globalUserState === 'active') {
          bot.answerCallbackQuery(callbackQuery.id, {text: preferenceGenderText, show_alert: false} );
          const updatedProfile = await Profile.findOneAndUpdate(
            { telegramId: userId },
            { 'preferences.preferredGender': gender },
            { new: true }
          );
          console.log('User gender preference updated:', updatedProfile);
    
          bot.deleteMessage(chatId, messageId);
          currentUserState.set(userId, 'search_settings');
          sendUpdatedSearchSettings(chatId, updatedProfile);
        }

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

        if (existingUser.globalUserState === 'registration_process') {

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
              'location.sentGeolocation': false,
              'preferences.preferredLocation.locality': selectedCity.locality,
              'preferences.preferredLocation.country': selectedCity.country || selectedCity.display_name.split(', ')[selectedCity.display_name.split(', ').length - 1],
            },
            { new: true }
          );
          console.log('User location updated:', updatedProfile);
  
          bot.answerCallbackQuery(callbackQuery.id, {text: `${i18n.__('location_notification')} ${selectedCity.display_name}`, show_alert: false});
          bot.deleteMessage(chatId, messageId);
  
          bot.sendMessage(chatId, i18n.__('enter_birthday_message'), { reply_markup: { remove_keyboard: true } }) // Текст ввода даты рождения
          currentUserState.set(userId, 'enter_birthday');

          //Обработка отправки названия города из меню Настройки поиска
        } else if (currentUserState.get(userId) === 'set_prefer_location' && existingUser.globalUserState === 'active') {

              const updatedProfile = await Profile.findOneAndUpdate(
              { telegramId: userId },
              {
                'preferences.preferredLocation.locality': selectedCity.locality,
                'preferences.preferredLocation.country': selectedCity.country || selectedCity.display_name.split(', ')[selectedCity.display_name.split(', ').length - 1],
              },
              { new: true }
            );
            console.log('User preferred location updated:', updatedProfile);

            bot.answerCallbackQuery(callbackQuery.id, {text: `${i18n.__('preferred_location_notification')} ${selectedCity.display_name || ''}`, show_alert: false});
            bot.deleteMessage(chatId, messageId);

            currentUserState.set(userId, 'search_settings');
            sendUpdatedSearchSettings(chatId, updatedProfile);

            //Обработка отправки названия города из меню Мое местоположение
        } else if (currentUserState.get(userId) === 'select_city' && existingUser.globalUserState === 'active') {

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
              'location.sentGeolocation': false,
              'preferences.preferredLocation.locality': selectedCity.locality,
              'preferences.preferredLocation.country': selectedCity.country || selectedCity.display_name.split(', ')[selectedCity.display_name.split(', ').length - 1],
            },
            { new: true }
          );
          console.log('User location updated:', updatedProfile);

          bot.answerCallbackQuery(callbackQuery.id, {text: `${i18n.__('location_notification')} ${selectedCity.display_name}`, show_alert: false});
          bot.deleteMessage(chatId, messageId);

          currentUserState.set(userId, 'search_settings');
          await sendMyUpdatedProfile(chatId, updatedProfile);
      }
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
      bot.deleteMessage(chatId, messageId);

      bot.sendMessage(chatId, i18n.__('main_menu_message'), {
        reply_markup: {
          keyboard: i18n.__('main_menu_buttons'),
          resize_keyboard: true
        }}
      )
    } else if (buttonsViewMatches.includes(data)) {
      const matchesProfiles = await getMatchesProfiles(userProfile);
      let currentMatchIndex = userProfile.viewingMatchIndex || 0;
      
        if ('previous_match_button' === data && currentMatchIndex > 0) {
          currentMatchIndex--;
        } else if ('next_match_button' === data && currentMatchIndex < matchesProfiles.length - 1) {
          currentMatchIndex++;
        } else if ('first_match_button' === data && currentMatchIndex === 0) {
          bot.answerCallbackQuery( callbackQuery.id, {text: i18n.__('no_previous_matches_message'), show_alert: false} );
          return;
        } else if ('last_match_button' === data && currentMatchIndex === matchesProfiles.length - 1) {
          bot.answerCallbackQuery( callbackQuery.id, {text: i18n.__('no_next_matches_message'), show_alert: false} );
          return;
        } else if ('delete_match_button' === data) {
          //Удаление совпадения
          return;
        }

      userProfile.viewingMatchIndex = currentMatchIndex;
      await userProfile.save();

      const currentMatchProfile = matchesProfiles[currentMatchIndex];
      await sendMatchProfile(chatId, currentMatchProfile, userProfile, messageId);
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

  console.log('User current state:', currentUserState.get(userId));

  // Получаем текущее состояние пользователя
  try {
    // Найти пользователя по идентификатору
    const existingUser = await User.findOne({ telegramId: userId });
    const userProfile = await Profile.findOne({ telegramId: userId });
    const userSubscriptions = await Subscriptions.findOne({ telegramId: userId });
    if (existingUser) {i18n.setLocale(existingUser.languageCode)};
    await updateUserLastActivity(userId);

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
                  'location.sentGeolocation': true,
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
            currentUserState.set(userId, 'viewing_profiles');
            const candidateProfile = await getCandidateProfile(Profile, userProfile);
            if (candidateProfile) {
              await sendCandidateProfile(chatId, candidateProfile, userProfile);
            } else {
              currentUserState.set(userId, 'main_menu');
              await bot.sendMessage(chatId, i18n.__('candidate_not_found_message'), {
                reply_markup: {
                  keyboard: i18n.__('main_menu_buttons'),
                  resize_keyboard: true
                }});
            }
          }  else if (msg.text === BUTTONS.MATCHES.en || msg.text === BUTTONS.MATCHES.ru) {
            currentUserState.set(userId, 'viewing_matches');

            const matchesProfiles = await getMatchesProfiles(userProfile);
          
            if (matchesProfiles.length > 0) {
              const currentMatchIndex = userProfile.viewingMatchIndex || 0;
              const currentMatchProfile = matchesProfiles[currentMatchIndex];

              bot.sendMessage(chatId, 'Просмотр совпадений', {
                reply_markup: {
                  keyboard: i18n.__('back_button'),
                  resize_keyboard: true
                }});

              await sendMatchProfile(chatId, currentMatchProfile, userProfile);
              
            } else {
              currentUserState.set(userId, 'main_menu');
              await bot.sendMessage(chatId, i18n.__('no_matches_message'));
            }

            } else if (msg.text === BUTTONS.LIKES_YOU.en || msg.text === BUTTONS.LIKES_YOU.ru) {
              currentUserState.set(userId, 'likes_you');
              await sendLikesYouProfiles(chatId, userId, userProfile, userSubscriptions);
            }
          break;
        case 'viewing_matches':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              }});
          }
          break;
        case 'likes_you':
          const likesYouProfiles = await Profile.find({
            likedProfiles: userProfile.telegramId,
          });
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.LIKE.en || msg.text === BUTTONS.LIKE.ru) {
            const firstOfLikesProfile = likesYouProfiles[0];

            //Сохранить информацию о лайке
            const likedCandidateProfileTelegramId = firstOfLikesProfile.telegramId;
            userProfile.likedProfiles.push(likedCandidateProfileTelegramId);
            await userProfile.save(); 

            //Отправка уведомления о совпадении профилю [0]
            await sendMatchNotification(firstOfLikesProfile, userProfile, i18n, User, existingUser);

          } else if (msg.text === BUTTONS.DISLIKE.en || msg.text === BUTTONS.DISLIKE.ru) {
            const firstOfLikesProfile = likesYouProfiles[0];
            const dislikedProfileTelegramId = firstOfLikesProfile.telegramId;
            userProfile.dislikedProfiles.push(dislikedProfileTelegramId);
            await userProfile.save();

            await sendLikesYouProfiles(chatId, userId, userProfile, userSubscriptions);

          } if (msg.text === BUTTONS.CONTINUE_VIEWING_BUTTON.en || msg.text === BUTTONS.CONTINUE_VIEWING_BUTTON.ru) {
            await sendLikesYouProfiles(chatId, userId, userProfile, userSubscriptions);
          }
          break;
        case 'settings_menu':
          if (msg.text === BUTTONS.MY_PROFILE.en || msg.text === BUTTONS.MY_PROFILE.ru) {
            currentUserState.set(userId, 'my_profile');
            await sendMyProfile(chatId, userProfile);
          } else if (msg.text === BUTTONS.SEARCH_SETTINGS.en || msg.text === BUTTONS.SEARCH_SETTINGS.ru) {
            currentUserState.set(userId, 'search_settings');
            await sendSearchSettings(chatId, userProfile);
          } else if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
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
          } 
          break;
        case 'viewing_profiles':
          //Обработка анкет
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.LIKE.en || msg.text === BUTTONS.LIKE.ru) {

            const candidateProfile = await getCandidateProfile(Profile, userProfile);
            if (candidateProfile) {

              //Сохранить информацию о лайке
              const likedCandidateProfileTelegramId = candidateProfile.telegramId;
              userProfile.likedProfiles.push(likedCandidateProfileTelegramId);
              await userProfile.save();

              // Проверить, если пользователь, которому отправлен лайк, также лайкнул текущего пользователя
              const likedCandidateProfile = await Profile.findOne({
                telegramId: likedCandidateProfileTelegramId,
                likedProfiles: userProfile.telegramId,
              });
                if (likedCandidateProfile) {
                  //Отправить уведомление о взаимной симпатии
                  currentUserState.set(userId, 'viewing_match');
                  console.log('candidate profile:', likedCandidateProfile);
                  await sendMatchNotification(likedCandidateProfile, userProfile, i18n, User, existingUser);
                } else {
                  //Отправить уведомление о лайке
                  await sendLikeNotificationPhoto(likedCandidateProfileTelegramId, userProfile, i18n, User, existingUser);

                  //Проверка остальных кандидатов
                  const nextCandidateProfile = await getCandidateProfile(Profile, userProfile);
                  if (nextCandidateProfile) {
                    await sendCandidateProfile(chatId, nextCandidateProfile, userProfile);
                  } else {
                    currentUserState.set(userId, 'main_menu');
                    await bot.sendMessage(chatId, i18n.__('candidate_not_found_message'), {
                      reply_markup: {
                        keyboard: i18n.__('main_menu_buttons'),
                        resize_keyboard: true
                      }
                    });
                }
              }
            } else {
              //Отправка сообщения что кандидатов нет и выход в главное меню
              currentUserState.set(userId, 'main_menu');
              await bot.sendMessage(chatId, i18n.__('candidate_not_found_message'), {
                reply_markup: {
                  keyboard: i18n.__('main_menu_buttons'),
                  resize_keyboard: true
                }});
            }
          } else if (msg.text === BUTTONS.DISLIKE.en || msg.text === BUTTONS.DISLIKE.ru) {

            const candidateProfile = await getCandidateProfile(Profile, userProfile);
            if (candidateProfile) {
              const dislikedProfileTelegramId = candidateProfile.telegramId;
              userProfile.dislikedProfiles.push(dislikedProfileTelegramId);
              await userProfile.save();
              const nextCandidateProfile = await getCandidateProfile(Profile, userProfile);
              if (nextCandidateProfile) {
                await sendCandidateProfile(chatId, nextCandidateProfile, userProfile);
              } else {
                currentUserState.set(userId, 'main_menu');
                await bot.sendMessage(chatId, i18n.__('candidate_not_found_message'), {
                  reply_markup: {
                    keyboard: i18n.__('main_menu_buttons'),
                    resize_keyboard: true
                  }
                });
              }
            } else {
              currentUserState.set(userId, 'main_menu');
              await bot.sendMessage(chatId, i18n.__('candidate_not_found_message'), {
                reply_markup: {
                  keyboard: i18n.__('main_menu_buttons'),
                  resize_keyboard: true
                }});
            }
          }
          break;
        case 'viewing_match':
          if (msg.text === BUTTONS.CONTINUE_VIEWING_BUTTON.en || msg.text === BUTTONS.CONTINUE_VIEWING_BUTTON.ru) { //логика продолжения просмотра профилей
            currentUserState.set(userId, 'viewing_profiles');
            const candidateProfile = await getCandidateProfile(Profile, userProfile);
            if (candidateProfile) {
              await sendCandidateProfile(chatId, candidateProfile, userProfile);
            } else {
              currentUserState.set(userId, 'main_menu');
              await bot.sendMessage(chatId, i18n.__('candidate_not_found_message'), {
                reply_markup: {
                  keyboard: i18n.__('main_menu_buttons'),
                  resize_keyboard: true
                }});
            }
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
          } else if (msg.text === BUTTONS.GENDER.en || msg.text === BUTTONS.GENDER.ru) {
            currentUserState.set(userId, 'select_prefer_gender');
            bot.sendMessage(chatId, i18n.__('select_prefer_gender_message'), {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: i18n.__('select_male'), callback_data: 'select_male' },
                    { text: i18n.__('select_female'), callback_data: 'select_female' },
                  ],
                ],
              },
              parse_mode: 'HTML',
            });
          } else if (msg.text === BUTTONS.AGE_RANGE.en || msg.text === BUTTONS.AGE_RANGE.ru) {
            currentUserState.set(userId, 'set_age_range');
            bot.sendMessage(chatId, i18n.__('set_age_range_message'), {
              reply_markup: {
                keyboard: i18n.__('back_button'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.PREFER_LOCATION.en || msg.text === BUTTONS.PREFER_LOCATION.ru) {
            currentUserState.set(userId, 'set_prefer_location');
            bot.sendMessage(chatId, i18n.__('set_prefer_location_message'), {
              reply_markup: {
                keyboard: i18n.__('back_button'),
                resize_keyboard: true
              },
              parse_mode: 'HTML',
            });
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
          } else if (msg.text === BUTTONS.PHOTO.en || msg.text === BUTTONS.PHOTO.ru) {
            currentUserState.set(userId, 'select_photo');
            bot.sendMessage(chatId, i18n.__('request_photo_message_text'), {
              reply_markup: {
                keyboard: i18n.__('back_button'),
                resize_keyboard: true
              }});
          } else if (msg.text === BUTTONS.MY_LOCATION.en || msg.text === BUTTONS.MY_LOCATION.ru) {
            currentUserState.set(userId, 'select_city');
            bot.sendMessage(chatId, i18n.__('request_location_or_city'), {
              reply_markup: {
                keyboard: [
                  [ `${i18n.__('back_button')}`, { text: i18n.__('send_location'), request_location: true } ],
                ],
                resize_keyboard: true,
              },
            });
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
          }  else if (msg.text.length > 1000) {
            const errorMessage = await bot.sendMessage(chatId, i18n.__('about_me_length_error'), {
            });
            setTimeout(async () => {
              try {
                await bot.deleteMessage(chatId, errorMessage.message_id);
              } catch (error) {
                console.error('Error deleting error message:', error);
              }
            }, 3000);
          } else {
            const updatedProfile = await Profile.findOneAndUpdate(
              { telegramId: userId },
              { aboutMe: msg.text },
              { new: true }
            );
            console.log('User aboutMe updated:', updatedProfile);

            currentUserState.set(userId, 'my_profile');
            sendMyUpdatedProfile(chatId, updatedProfile);
          }
          break;
        case 'select_language':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'settings_menu');
            bot.sendMessage(chatId, i18n.__('settings_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('settings_menu_buttons'),
                resize_keyboard: true
              }});
          } else {
            const wrongSelected = await bot.sendMessage(chatId, i18n.__('wrong_choise_message'));
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, wrongSelected.message_id);
                } catch (error) {
                    console.error('Error:', error);
                }
            }, 2000);
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
        case 'select_city':   // Обработка полученной локации или названия города
        if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
          currentUserState.set(userId, 'my_profile');
          await sendMyProfile(chatId, userProfile);
        } else if (locationMessage) {
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
                  'location.sentGeolocation': true,
                },
                { new: true }
              );
              console.log('User location updated:', updatedProfile);

              const savedMessage = await bot.sendMessage(chatId, `${i18n.__('location_notification')} ${locality}, ${country}`, { reply_markup: { remove_keyboard: true } });
              setTimeout(async () => {
                try {
                  await bot.deleteMessage(chatId, savedMessage.message_id);
                  await sendMyUpdatedProfile(chatId, updatedProfile);
                } catch (error) {
                  console.error('Error:', error);
                }
              }, 3000);

              currentUserState.set(userId, 'my_profile');

            } catch (err) {
              console.error('Error updating user location:', err);
            }
          } else if(cityName) {
            // Если получено сообщение с текстом (название города), обработать его
            await getFromCityName(cityName, bot, chatId, locationDataMap);
          }
          break;
        case 'select_prefer_gender':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'search_settings');
            sendSearchSettings(chatId, userProfile);
          } else {
            const wrongSelected = await bot.sendMessage(chatId, i18n.__('wrong_choise_message'));
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, wrongSelected.message_id);
                } catch (error) {
                    console.error('Error:', error);
                }
            }, 2000);
          }
          break;
        case 'set_age_range':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'search_settings');
            sendSearchSettings(chatId, userProfile);
          } else {
            handleAgeRangeInput(userId, msg.text, chatId);
          }
          break;
        case 'set_prefer_location':
          if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'search_settings');
            sendSearchSettings(chatId, userProfile);
          } else {
            await getFromCityName(cityName, bot, chatId, locationDataMap);
          }
          break;
        case undefined:  //на время отладки меню
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              },
              parse_mode: 'HTML',
            });
          break;
      }
    }
  } catch (err) {
    console.error('Error retrieving user state:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при обработке сообщения.');
  }
});

// Поиск профиля, который поставил лайк текущему пользователю и вызов функции отправки профиля с индексом [0]
async function sendLikesYouProfiles(chatId, userId, userProfile, userSubscriptions) {
  try {
    const likesYouProfiles = await Profile.find({
      likedProfiles: userProfile.telegramId,
      telegramId: { $nin: [...userProfile.likedProfiles, ...userProfile.dislikedProfiles, ...userProfile.matches] },
    });
    if (likesYouProfiles && likesYouProfiles.length > 0) {
      const firstOfLikesProfile = likesYouProfiles[0];
        await sendCandidateProfile(chatId, firstOfLikesProfile, userProfile, userSubscriptions);
    } else {
      currentUserState.set(userId, 'main_menu');
      await bot.sendMessage(chatId, i18n.__('no_likes_you_profiles_message'), {
        reply_markup: {
          keyboard: i18n.__('main_menu_buttons'),
          resize_keyboard: true
        }});
    }
  } catch (error) {
    console.error('Error sending liked profiles:', error);
  }
}


async function getMatchesProfiles(userProfile) {
  try {
    const matchesProfiles = await Profile.find({
      telegramId: { $in: userProfile.matches },
    });

    return matchesProfiles;
  } catch (error) {
    console.error('Error getting matches profiles:', error);
    return [];
  }
}

async function sendMatchProfile(chatId, matchProfile, userProfile, messageId) {
  try {
    const aboutMeText = matchProfile.aboutMe ? `<blockquote><i>${matchProfile.aboutMe}</i></blockquote>` : '';
    const distance = await calculateAndReturnDistance(userProfile, matchProfile);
    const distanceText = distance !== null ? `\n📍 ${distance} ${i18n.__('km_away_message')}` : '';
    const captionInfo = `${matchProfile.profileName}, ${matchProfile.age}\n${i18n.__('candidate_lives_message')}${matchProfile.location.locality}, ${matchProfile.location.country}${distanceText}\n${getLastActivityStatus(matchProfile.lastActivity)}\n${aboutMeText}`;
    const currentMatchIndex = userProfile.viewingMatchIndex || 0;

    // Set callback_data based on match index
    const previousCallbackData = currentMatchIndex > 0 ? 'previous_match_button' : 'first_match_button';
    const nextCallbackData = currentMatchIndex < userProfile.matches.length - 1 ? 'next_match_button' : 'last_match_button';

    // Create inline keyboard based on match index
    const inlineKeyboardMain = {
      inline_keyboard: [
        [
          { text: i18n.__(previousCallbackData), callback_data: previousCallbackData },
          { text: '💌', url: `https://t.me/${matchProfile.userName}` },
          { text: i18n.__(nextCallbackData), callback_data: nextCallbackData },
        ],
      ],
    }

    // Проверяем наличие messageId перед вызовом editMessageMedia
    if (messageId) {
      await bot.editMessageMedia(
        { type: 'photo', media: matchProfile.profilePhoto.photoPath,
          caption: captionInfo,
          parse_mode: 'HTML',
        },
        { chat_id: chatId, message_id: messageId, 
          reply_markup: inlineKeyboardMain,
        });

    } else {
        await bot.sendPhoto(chatId, matchProfile.profilePhoto.photoPath, {
          caption: captionInfo,
          reply_markup: inlineKeyboardMain,
          parse_mode: 'HTML',
          protect_content: true,
        });
    }
    

  } catch (error) {
    console.error('Error sending match profile:', error);
  }
}

// Функция для отправки уведомления о Взаимном лайке
async function sendMatchNotification(likedCandidateProfile, userProfile, i18n, User, existingUser) {
  
  try {
    userProfile.matches.push(likedCandidateProfile.telegramId);
    likedCandidateProfile.matches.push(userProfile.telegramId);

    await userProfile.save();
    await likedCandidateProfile.save();

    // Отправить уведомление об успешном совпадении пользователю
    await bot.sendPhoto(userProfile.telegramId, likedCandidateProfile.profilePhoto.photoPath, {
      caption: `${i18n.__('match_found_message')}\n\n${likedCandidateProfile.profileName}: ${i18n.__('candidate_quote_message')}`,
      reply_markup: {
        keyboard: i18n.__('viewing_match_buttons'),
        resize_keyboard: true
      },
      parse_mode: 'HTML',
      protect_content: true,
    });

    await bot.sendMessage(userProfile.telegramId, `${i18n.__('write_liked_user_message')} <b>${likedCandidateProfile.profileName}</b>`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: i18n.__('write_liked_user_inline_keyboard'), url: `https://t.me/${likedCandidateProfile.userName}` }]
        ]
      },
      parse_mode: 'HTML',
    });

    // Отправить уведомление об успешном совпадении кандидату
    const likedCandidateUser = await User.findOne({ telegramId: likedCandidateProfile.telegramId });
    const likedCandidateLanguageCode = likedCandidateUser.languageCode;
    i18n.setLocale(likedCandidateLanguageCode);
    await bot.sendPhoto(likedCandidateProfile.telegramId, userProfile.profilePhoto.photoPath, {
      caption: `${i18n.__('match_found_message')}\n\n${userProfile.profileName}: ${i18n.__('candidate_quote_message')}`,
      reply_markup: {
        inline_keyboard: [
          [{ text: `${i18n.__('write_liked_candidate_inline_keyboard')} ${userProfile.profileName}`, url: `https://t.me/${userProfile.userName}` }]
        ]
      },
      parse_mode: 'HTML',
      protect_content: true,
    });
    i18n.setLocale(existingUser.languageCode);

  } catch (error) {
    console.error('Error sending match notification:', error);
  }
}

async function sendMyProfile(chatId, userProfile) {
  let aboutMeText = userProfile.aboutMe ? `<blockquote><i>${userProfile.aboutMe}</i></blockquote>` : '';
  const genderText = userProfile.gender === 'male' ? i18n.__('select_male') : i18n.__('select_female');
  bot.sendPhoto(chatId, userProfile.profilePhoto.photoPath, {
    caption: `${userProfile.profileName}, ${userProfile.age}\n🏠${userProfile.location.locality}, ${userProfile.location.country}\n${genderText}\n${aboutMeText}`,
    reply_markup: {
      keyboard: i18n.__('myprofile_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
    protect_content: true,
  });
}

async function sendMyUpdatedProfile(chatId, updatedProfile) {
  let aboutMeText = updatedProfile.aboutMe ? `<blockquote><i>${updatedProfile.aboutMe}</i></blockquote>` : '';
  const genderText = updatedProfile.gender === 'male' ? i18n.__('select_male') : i18n.__('select_female');
  bot.sendPhoto(chatId, updatedProfile.profilePhoto.photoPath, {
    caption: `${updatedProfile.profileName}, ${updatedProfile.age}\n🏠${updatedProfile.location.locality}, ${updatedProfile.location.country}\n${genderText}\n${aboutMeText}`,
    reply_markup: {
      keyboard: i18n.__('myprofile_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
    protect_content: true,
  });
}

async function sendSearchSettings(chatId, userProfile) {
  const preferenceGenderText = userProfile.preferences.preferredGender === 'male' ? i18n.__('preference_gender_selected_male') : i18n.__('preference_gender_selected_female');
  bot.sendMessage(chatId, `${i18n.__('search_settings_message')}\n ${preferenceGenderText}\n ${i18n.__('age_range_message')} ${userProfile.preferences.ageRange.min}-${userProfile.preferences.ageRange.max}\n ${i18n.__('location_message')} ${userProfile.preferences.preferredLocation.locality}, ${userProfile.preferences.preferredLocation.country}`, {
    reply_markup: {
      keyboard: i18n.__('search_settings_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
  });
}

async function sendUpdatedSearchSettings(chatId, updatedProfile) {
  const preferenceGenderText = updatedProfile.preferences.preferredGender === 'male' ? i18n.__('preference_gender_selected_male') : i18n.__('preference_gender_selected_female');
  bot.sendMessage(chatId, `${i18n.__('search_settings_message')}\n ${preferenceGenderText}\n ${i18n.__('age_range_message')} ${updatedProfile.preferences.ageRange.min}-${updatedProfile.preferences.ageRange.max}\n ${i18n.__('location_message')} ${updatedProfile.preferences.preferredLocation.locality}, ${updatedProfile.preferences.preferredLocation.country}`, {
    reply_markup: {
      keyboard: i18n.__('search_settings_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
  });
}

// Функция отправки профиля кандидата
async function sendCandidateProfile(chatId, candidateProfile, userProfile, userSubscriptions) {
  let aboutMeText = candidateProfile.aboutMe ? `<blockquote><i>${candidateProfile.aboutMe}</i></blockquote>` : '';

  const distance = await calculateAndReturnDistance(userProfile, candidateProfile);
  const distanceText = distance !== null ? `\n📍 ${distance} ${i18n.__('km_away_message')}` : '';
  try {
    const currentState = currentUserState.get(userProfile.telegramId);
    const canViewProfile = currentState === 'viewing_profiles' || (currentState === 'likes_you' && userSubscriptions.isActive && userSubscriptions.subscriptionType === 'premium');
    if (canViewProfile) {
      await bot.sendPhoto(chatId, candidateProfile.profilePhoto.photoPath, {
        caption: `${candidateProfile.profileName}, ${candidateProfile.age}\n${i18n.__('candidate_lives_message')}${candidateProfile.location.locality}, ${candidateProfile.location.country}${distanceText}\n${getLastActivityStatus(candidateProfile.lastActivity)}\n${aboutMeText}`,
        reply_markup: {
          keyboard: i18n.__('viewing_profiles_buttons'),
          resize_keyboard: true },
        parse_mode: 'HTML',
        protect_content: true,
      });
    } else {
      currentUserState.set(userProfile.telegramId, 'main_menu');
      await bot.sendMessage(chatId, i18n.__('buy_premium_message'), {
        reply_markup: {
          keyboard: i18n.__('main_menu_buttons'),
          resize_keyboard: true
        }});
      await bot.sendPhoto(chatId, candidateProfile.profilePhoto.photoBlurredPath, {
        caption: `${candidateProfile.profileName}`,
        reply_markup: {
          inline_keyboard:  [
            [{ text: i18n.__('buy_premium_button'), callback_data: 'buy_premium_button' }],
          ],
          resize_keyboard: true },
        parse_mode: 'HTML',
        protect_content: true,
      });
    }
  } catch (error) {
    console.error('Error sending candidate profiles:', error);
  }
}

// Функция поиска профиля кандидата
async function getCandidateProfile(Profile, userProfile) {
  try {
    const candidateProfile = await Profile.findOne({
      gender: userProfile.preferences.preferredGender,
      age: { $gte: userProfile.preferences.ageRange.min, $lte: userProfile.preferences.ageRange.max },
      'location.locality': userProfile.preferences.preferredLocation.locality,
      'location.country': userProfile.preferences.preferredLocation.country,
      telegramId: { $nin: [...userProfile.likedProfiles, ...userProfile.dislikedProfiles, ...userProfile.matches] },
      'dislikedProfiles': { $ne: userProfile.telegramId },
      // Другие условия совпадения в соответствии с предпочтениями пользователя
      //'location': {'$near': {'$geometry': {'type': 'Point', 'coordinates': [user_longitude, user_latitude]}, '$maxDistance': max_distance}}
      'preferences.preferredGender': userProfile.gender,
      'preferences.ageRange.min': { $lte: userProfile.age },
      'preferences.ageRange.max': { $gte: userProfile.age },
    });

    if (candidateProfile) {
      return candidateProfile.toObject();
    } else {
      return null; // Если кандидат не найден
    }
  } catch (error) {
    console.error('Error getting candidate profile:', error);
    return null;
  }
}

// Функция для отправки уведомления о лайке
async function sendLikeNotificationPhoto(likedCandidateProfileTelegramId, userProfile, i18n, User, existingUser) {

  const likedCandidateUser = await User.findOne({ telegramId: likedCandidateProfileTelegramId });
  const likedCandidateLanguageCode = likedCandidateUser.languageCode;
  const likedCandidateUserSubscription = await Subscriptions.findOne({ telegramId: likedCandidateProfileTelegramId });
  const isPremiumUser = likedCandidateUserSubscription.isActive && likedCandidateUserSubscription.subscriptionType === 'premium';
  try {
    i18n.setLocale(likedCandidateLanguageCode);
    if (isPremiumUser) {
      bot.sendPhoto(likedCandidateProfileTelegramId, userProfile.profilePhoto.photoPath, {
        caption: `${userProfile.profileName},${userProfile.age}\n${i18n.__('user_liked_premium_message')}`,
        parse_mode: 'HTML',
        protect_content: true,
      });
    } else {
      bot.sendPhoto(likedCandidateProfileTelegramId, userProfile.profilePhoto.photoBlurredPath, {
        caption: `${i18n.__('user_liked_message')}`,
        //Отправить inline-кнопку (возможность просматривать лайки, реализация позже)
        parse_mode: 'HTML',
        protect_content: true,
      });
    }
    i18n.setLocale(existingUser.languageCode);
  } catch (error) {
    console.error('Error sending like notification:', error);
  }
}

async function handleAgeRangeInput(userId, input, chatId) {
  try {
    const [min, max] = input.match(/\d+/g).map(Number);

    if (isNaN(min) || isNaN(max)) {
      const wrongInput = await bot.sendMessage(chatId, i18n.__('wrong_agerange_message'));
      setTimeout(async () => {
          try {
              await bot.deleteMessage(chatId, wrongInput.message_id);
          } catch (error) {
              console.error('Error:', error);
          }
      }, 2000);
    } else {
      const newMin = Math.min(min, max);
      const newMax = Math.max(min, max);
      const updatedProfile = await Profile.findOneAndUpdate(
        { telegramId: userId },
        {
          $set: {
            'preferences.ageRange.min': newMin,
            'preferences.ageRange.max': newMax,
          },
        },
        { upsert: true, new: true }
      );

      currentUserState.set(userId, 'search_settings');
      sendUpdatedSearchSettings(chatId, updatedProfile);
    }
  } catch (error) {
    console.error('Error handling age range input:', error);
    bot.sendMessage(chatId, i18n.__('error_agerange_input_message'));
  }
}

async function updateUserLastActivity(userId) {
  try {
    let updatedProfile = await Profile.findOneAndUpdate(
      { telegramId: userId },
      { lastActivity: Date.now() },
      { new: true }
    );
    //console.log('User lastActivity updated:', updatedProfile);
  } catch (error) {
    console.error('Error updating user lastActivity:', error);
  }
}

function getLastActivityStatus(lastActivity) {

  const now = moment();
  const lastActivityMoment = moment(lastActivity);
  const duration = moment.duration(now.diff(lastActivityMoment));

  if (duration.asMinutes() < 1) {
    return i18n.__('online_message');
  } else if (duration.asWeeks() < 1) {
    return i18n.__('recently_message');
  } else if (duration.asMonths() < 1) {
    return i18n.__('more_than_week_message');
  } else {
    return i18n.__('more_than_month_message');
  }
}