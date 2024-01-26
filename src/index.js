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
import sharp from 'sharp';
import moment from 'moment';

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
  createdAt: Date,
}, { versionKey: false });
// Модель пользователя
userSchema.index({ telegramId: 1 }, { unique: true });
const User = mongoose.model('User', userSchema, 'users');

// Схема профиля
const profileSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  telegramId: Number,
  userName: String,
  profileName: String,
  gender: String,
  birthday: Number,
  age: Number,
  interests: String,
  aboutMe: String,
  createdAt: Date,
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
    photo_id: mongoose.Schema.Types.ObjectId,
    telegramId: Number,
    photoPath: String,
    photoLocalPath: String,
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
  }],
  dislikedProfiles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
  }],
  matches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
  }],
}, { versionKey: false });
// Модель профиля
profileSchema.index({ telegramId: 1 }, { unique: true });
const Profile = mongoose.model('Profile', profileSchema, 'profiles');

//Схема фотографий профиля
const userPhotoSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: Date,
  photos: [{
    filename: String,
    path: String,
    localPath: String,
    size: Number,
    uploadDate: { type: Date, default: Date.now },
    verifiedPhoto: { type: Boolean, default: false },
  }]
}, { versionKey: false });
//Модель фотографий профиля
const UserPhoto = mongoose.model('UserPhoto', userPhotoSchema, 'usersPhotos');

//Схема совпадений
const matchesSchema = new mongoose.Schema({
  user_id: mongoose.Schema.Types.ObjectId,
}, { versionKey: false });
//Модель совпадений
const Matches = mongoose.model('Matches', matchesSchema, 'matches');

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
    createdAt: Date.now(),
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
        createdAt: Date.now(),
        // Add other profile properties as needed
      };
      const createdProfile = await Profile.create(profileData);
      console.log('Profile created for the new user:', createdProfile);

      const userPhotoData = {
        user_id: createdUser._id,
        telegramId: createdUser.telegramId,
        createdAt: Date.now(),
      };
      const createdUserPhoto = await UserPhoto.create(userPhotoData);
      console.log('UserPhoto created for the new user:', createdUserPhoto);

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
  await updateUserLastActivity(userId);

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
          bot.answerCallbackQuery(callbackQuery.id, {text: genderText, show_alert: false} );
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
        } else if (existingUser.globalUserState === 'active') {

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
    } else if ('continue_viewing' === data) {
      // Обработка нажатия кнопки "⏩ Продолжить просмотр анкет"
      currentUserState.set(userId, 'viewing_profiles');
      const candidateProfile = await getCandidateProfile(Profile, userProfile);
      if (candidateProfile) {
        await sendCandidateProfile(chatId, candidateProfile);
      } else {
        currentUserState.set(userId, 'main_menu');
        await bot.sendMessage(chatId, i18n.__('candidate_not_found_message'), {
          reply_markup: {
            keyboard: i18n.__('main_menu_buttons'),
            resize_keyboard: true
          }});
      }
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
              await sendCandidateProfile(chatId, candidateProfile);
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
            //Отправить совпадения
            }//далее условия для "Вы понравились"
          break;
        case 'settings_menu':
          if (msg.text === BUTTONS.MY_PROFILE.en || msg.text === BUTTONS.MY_PROFILE.ru) {
            currentUserState.set(userId, 'my_profile');
            sendMyProfile(chatId, userProfile);
          } else if (msg.text === BUTTONS.SEARCH_SETTINGS.en || msg.text === BUTTONS.SEARCH_SETTINGS.ru) {
            currentUserState.set(userId, 'search_settings');
            sendSearchSettings(chatId, userProfile);
          } else if (msg.text === BUTTONS.BACK.en || msg.text === BUTTONS.BACK.ru) {
            currentUserState.set(userId, 'main_menu');
            bot.sendMessage(chatId, i18n.__('main_menu_message'), {
              reply_markup: {
                keyboard: i18n.__('main_menu_buttons'),
                resize_keyboard: true
              }});
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
              const likedCandidateProfileId = candidateProfile._id;
              const likedCandidateProfileTelegramId = candidateProfile.telegramId;
              userProfile.likedProfiles.push(likedCandidateProfileId);
              await userProfile.save();

              // Проверить, если пользователь, которому отправлен лайк, также лайкнул текущего пользователя
              const likedCandidateProfile = await Profile.findOne({
                telegramId: likedCandidateProfileTelegramId,
                likedProfiles: userProfile._id,
              });
                if (likedCandidateProfile) {
                  //Отправить уведомление о взаимной симпатии
                  await sendMatchNotification(likedCandidateProfile, userProfile);
                } else {
                  //Отправить уведомление о лайке
                  await sendLikeNotificationBlurPhoto(likedCandidateProfileTelegramId, userProfile);

                  //Проверка остальных кандидатов
                  const nextCandidateProfile = await getCandidateProfile(Profile, userProfile);
                  if (nextCandidateProfile) {
                    await sendCandidateProfile(chatId, nextCandidateProfile);
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
              const dislikedProfileId = candidateProfile._id;
              userProfile.dislikedProfiles.push(dislikedProfileId);
              await userProfile.save();
              const nextCandidateProfile = await getCandidateProfile(Profile, userProfile);
              if (nextCandidateProfile) {
                await sendCandidateProfile(chatId, nextCandidateProfile);
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

function sendMyProfile(chatId, userProfile) {
  let aboutMeText = userProfile.aboutMe ? `<blockquote><i>${userProfile.aboutMe}</i></blockquote>` : '';
  bot.sendPhoto(chatId, userProfile.profilePhoto.photoPath, {
    caption: `${userProfile.profileName}, ${userProfile.age}\n 🌍${userProfile.location.locality}, ${userProfile.location.country}\n${i18n.__('myprofile_gender_message')} ${userProfile.gender}\n\n${aboutMeText}`,
    reply_markup: {
      keyboard: i18n.__('myprofile_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
    protect_content: true,
  });
}

function sendMyUpdatedProfile(chatId, updatedProfile) {
  let aboutMeText = updatedProfile.aboutMe ? `<blockquote><i>${updatedProfile.aboutMe}</i></blockquote>` : '';
  bot.sendPhoto(chatId, updatedProfile.profilePhoto.photoPath, {
    caption: `${updatedProfile.profileName}, ${updatedProfile.age}\n 🌍${updatedProfile.location.locality}, ${updatedProfile.location.country}\n${i18n.__('myprofile_gender_message')} ${updatedProfile.gender}\n\n${aboutMeText}`,
    reply_markup: {
      keyboard: i18n.__('myprofile_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
    protect_content: true,
  });
}

function sendSearchSettings(chatId, userProfile) {
  bot.sendMessage(chatId, `<u>${i18n.__('search_settings_message')}</u>\n ${i18n.__('myprofile_gender_message')} ${userProfile.preferences.preferredGender}\n ${i18n.__('age_range_message')} ${userProfile.preferences.ageRange.min}-${userProfile.preferences.ageRange.max}\n ${i18n.__('location_message')} ${userProfile.preferences.preferredLocation.locality}, ${userProfile.preferences.preferredLocation.country}`, {
    reply_markup: {
      keyboard: i18n.__('search_settings_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
  });
}

function sendUpdatedSearchSettings(chatId, updatedProfile) {
  bot.sendMessage(chatId, `<u>${i18n.__('search_settings_message')}</u>\n ${i18n.__('myprofile_gender_message')} ${updatedProfile.preferences.preferredGender}\n ${i18n.__('age_range_message')} ${updatedProfile.preferences.ageRange.min}-${updatedProfile.preferences.ageRange.max}\n ${i18n.__('location_message')} ${updatedProfile.preferences.preferredLocation.locality}, ${updatedProfile.preferences.preferredLocation.country}`, {
    reply_markup: {
      keyboard: i18n.__('search_settings_buttons'),
      resize_keyboard: true
    },
    parse_mode: 'HTML',
  });
}

// Функция отправки профиля кандидата
async function sendCandidateProfile(chatId, candidateProfile) {
  let aboutMeText = candidateProfile.aboutMe ? `<blockquote><i>${candidateProfile.aboutMe}</i></blockquote>` : '';

  await bot.sendPhoto(chatId, candidateProfile.profilePhoto.photoPath, {
    caption: `${candidateProfile.profileName}, ${candidateProfile.age}\n🌍${candidateProfile.location.locality}, ${candidateProfile.location.country}\n${getLastActivityStatus(candidateProfile.lastActivity)}\n\n\n${aboutMeText}`,
    reply_markup: {
      keyboard: i18n.__('viewing_profiles_buttons'),
      resize_keyboard: true },
    parse_mode: 'HTML',
    protect_content: true,
  });
}

// Функция для отправки уведомления о Взаимном лайке
async function sendMatchNotification(likedCandidateProfile, userProfile) {
  try {
    userProfile.matches.push(likedCandidateProfile._id);
    likedCandidateProfile.matches.push(userProfile._id);

    await userProfile.save();
    await likedCandidateProfile.save();

    // Отправить уведомление об успешном совпадении пользователю
    await bot.sendMessage(userProfile.telegramId, i18n.__('match_found_message'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: `${i18n.__('write_liked_user_message')} ${likedCandidateProfile.profileName}`, url: `https://t.me/${likedCandidateProfile.userName}` }],
          [{ text: `${i18n.__('continue_viewing_message')}`, callback_data: 'continue_viewing' }]
        ]
      }
    });

    // Отправить уведомление об успешном совпадении кандидату
    await bot.sendMessage(likedCandidateProfile.telegramId, i18n.__('match_found_message'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: `${i18n.__('write_liked_user_message')} ${userProfile.profileName}`, url: `https://t.me/${userProfile.userName}` }]
        ]
      }
    });
  } catch (error) {
    console.error('Error sending match notification:', error);
  }
}

// Функция для отправки уведомления о лайке
async function sendLikeNotificationBlurPhoto(likedCandidateProfileTelegramId, userProfile) {

  const blurredPhotoBuffer = await blurImage(userProfile.profilePhoto.photoLocalPath);

  // Функция для размытия изображения
  async function blurImage(photoPath) {
    try {
      const imageBuffer = await sharp(photoPath)
        .resize(300) // Размер, на который вы хотите изменить изображение
        .blur(15) // Значение размытия
        .toBuffer();

      return imageBuffer;
    } catch (error) {
      console.error('Error blurring image:', error);
      return null;
    }
  }
  try {
    // Проверить, если пользователь, которому отправлен лайк, также лайкнул текущего пользователя
    const likedCandidateProfile = await Profile.findOne({
      telegramId: likedCandidateProfileTelegramId,
      likedProfiles: userProfile._id,
    });
    
      if (likedCandidateProfile) {
        // Оба пользователей лайкнули друг друга - это совпадение!
        userProfile.matches.push(likedCandidateProfile._id);
        likedCandidateProfile.matches.push(userProfile._id);
        await userProfile.save();
        await likedCandidateProfile.save();
        
        // Отправить уведомление об успешном совпадении
        bot.sendMessage(userProfile.telegramId, i18n.__('match_found_message'), {
          reply_markup: {
            inline_keyboard: [
              [  { text: `${i18n.__('write_liked_user_message')} ${likedCandidateProfile.profileName}`, url: `https://t.me/${likedCandidateProfile.userName}` } ],
              [  { text: `${i18n.__('continue_viewing_message')}`, callback_data: 'continue_viewing' }  ]
            ]
          }
        });
        
        bot.sendMessage(likedCandidateProfileTelegramId, i18n.__('match_found_message'), {
          reply_markup: {
            inline_keyboard: [
              [
                { text: `${i18n.__('write_liked_user_message')} ${userProfile.profileName}`, url: `https://t.me/${userProfile.userName}` },
              ]
            ]
          }
        });
      } else {
        bot.sendPhoto(likedCandidateProfileTelegramId, blurredPhotoBuffer, {
          caption: `${i18n.__('user_liked_message')}`,
          //Отправить inline-кнопку (возможность просматривать лайки, реализация позже)
          parse_mode: 'HTML',
          protect_content: true,
        });
      }
  } catch (error) {
    console.error('Error sending like notification:', error);
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
      _id: { $nin: [...userProfile.likedProfiles, ...userProfile.dislikedProfiles, ...userProfile.matches] },
      // Другие условия совпадения в соответствии с предпочтениями пользователя
      //'location': {'$near': {'$geometry': {'type': 'Point', 'coordinates': [user_longitude, user_latitude]}, '$maxDistance': max_distance}}
      'preferences.preferredGender': userProfile.gender,
      'preferences.ageRange.min': { $lte: userProfile.age },
      'preferences.ageRange.max': { $gte: userProfile.age },
    });

    //const isProfileLiked = userProfile.likedProfiles.includes(candidateProfile._id);
    if (candidateProfile /*&& !isProfileLiked*/) {
      return candidateProfile.toObject();
    } else {
      return null; // Если кандидат не найден
    }
  } catch (error) {
    console.error('Error getting candidate profile:', error);
    return null;
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
    const updatedProfile = await Profile.findOneAndUpdate(
      { telegramId: userId },
      { lastActivity: Date.now() },
      { new: true }
    );
    console.log('User lastActivity updated:', updatedProfile);
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