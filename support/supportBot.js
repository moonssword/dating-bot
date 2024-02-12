import 'dotenv/config';
import i18n from 'i18n';
import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import { User, Profile, UserPhoto, Subscriptions } from '../src/models.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

mongoose.connect('mongodb://localhost:27017/userdata')
.then(() => console.log('Connected to MongoDB support'))
.catch((error) => console.error('Connection to MongoDB support failed:', error));

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

i18n.configure({
  locales: ['en', 'ru'],
  directory: `${__dirname}/locales`,
  //defaultLocale: 'ru',
  objectNotation: true,
});

const bot = new TelegramBot(process.env.support_bot_token, { polling: true });

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const existingUser = await User.findOne({ telegramId: userId });

  try {
    i18n.setLocale(existingUser.languageCode);

      bot.sendMessage(chatId, i18n.__('messages.main'), {
        reply_markup: {
          inline_keyboard: [
            [ { text: i18n.__('buttons.feedback'), callback_data: 'feedback' }],
            [ { text: i18n.__('buttons.unblock'), callback_data: 'unblock' }],
            [ { text: i18n.__('buttons.delete_account'), callback_data: 'delete_account' }],
            [ { text: i18n.__('buttons.subscription'), callback_data: 'subscription' }],
            [ { text: i18n.__('buttons.contact_support'), callback_data: 'contact_support' }],
          ],
        },
        parse_mode: 'HTML',
      });
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "An error has occurred /start");
  }
});

// Пример обработки инлайн кнопок для блокировки/разблокировки
bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  switch (action) {
    case 'delete_account':
      bot.editMessageText(i18n.__('messages.confirm_delete_account'), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: i18n.__('buttons.confirm'), callback_data: 'confirm_delete' },
            { text: i18n.__('buttons.cancel'), callback_data: 'cancel_delete' }],
            [{ text: i18n.__('buttons.back'), callback_data: 'back_to_main' }]
          ]
        },
        parse_mode: 'HTML'
      });
      break;
    case 'confirm_delete':
      await User.findOneAndUpdate({ telegramId: userId }, { $set: { globalUserState: 'deleted', blockReason: 'deleted_himself', isBlocked: true, blockDetails: {blockedAt: Date.now()} } });
      bot.sendMessage(msg.chat.id, i18n.__('messages.account_deleted'));
      break;
    case 'cancel_delete':
      bot.sendMessage(msg.chat.id, i18n.__('messages.deletion_cancelled'));
      break;

    case 'unblock':
      const existingUser = await User.findOne({ telegramId: userId });
      if (existingUser.isBlocked) {

      }
      break;

    case 'subscription':
      const userSubscription = await Subscriptions.findOne({ telegramId: userId });
      let status = userSubscription.isActive ? i18n.__('Active') : i18n.__('Inactive');
      let validity = userSubscription.endDate ? userSubscription.endDate.toLocaleDateString() : i18n.__('Indefinitely');

      bot.editMessageText(i18n.__('messages.current_subscription', { subscriptionType: userSubscription.subscriptionType, status: status, validity: validity }), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            // Subscription details buttons, plus a 'Back' button to return to the main menu
            [{ text: i18n.__('buttons.back'), callback_data: 'back_to_main' }]
          ]
        },
        parse_mode: 'HTML'
      });
      break;

    case 'contact_support':
      // Логика для связи со спеуиалистом техподдержки
        break;

    case 'feedback':
      // Логика для обратной связи
        break;

    case 'back_to_main':
      bot.editMessageText(i18n.__('messages.main'), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [ { text: i18n.__('buttons.feedback'), callback_data: 'feedback' }],
            [ { text: i18n.__('buttons.unblock'), callback_data: 'unblock' }],
            [ { text: i18n.__('buttons.delete_account'), callback_data: 'delete_account' }],
            [ { text: i18n.__('buttons.subscription'), callback_data: 'subscription' }],
            [ { text: i18n.__('buttons.contact_support'), callback_data: 'contact_support' }],
          ],
        },
        parse_mode: 'HTML'
      });
      break;
  }
});

bot.on('message', (msg) => {
  if (msg.text === 'Обратная связь') {
    // Логика для обратной связи
    bot.sendMessage(msg.chat.id, "Оставьте ваш отзыв:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Написать оператору", callback_data: 'contact_support' }]
        ]
      }
    });
  }
});

