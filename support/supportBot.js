import 'dotenv/config';
import i18n from 'i18n';
import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import { User, Profile, UserPhoto, Subscriptions } from '../src/models.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { URLS, BOT_NAMES } from '../src/constants.js';

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

bot.on('callback_query', async (callbackQuery) => {
  const [action, targetUserId] = callbackQuery.data.split(':');
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const adminUserId = callbackQuery.from.id;
  const existingUser = await User.findOne({ telegramId: userId });
  i18n.setLocale(existingUser.languageCode);
 try {
  switch (action) {
    case 'delete_account':
      bot.editMessageText(i18n.__('messages.confirm_delete_account'), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: i18n.__('buttons.confirm'), callback_data: 'confirm_delete' },
            { text: i18n.__('buttons.cancel'), callback_data: 'back_to_main' }],
          ]
        },
        parse_mode: 'HTML'
      });
      break;
    case 'confirm_delete':
      await User.findOneAndUpdate({ telegramId: userId }, { $set: { globalUserState: 'deleted', blockReason: 'deleted_himself', isBlocked: true, blockDetails: {blockedAt: Date.now()} } });
      bot.sendMessage(msg.chat.id, i18n.__('messages.account_deleted'));
      break;

    case 'unblock':
      const existingUser = await User.findOne({ telegramId: userId });
      const userProfile = await Profile.findOne({ telegramId: userId });

      if (existingUser && existingUser.isBlocked && existingUser.globalUserState === 'blocked' || existingUser.globalUserState === 'rejected') {
        const requestMessage = `User @${existingUser.userName} (${userId}) requests an unlock.\nReason: ${existingUser.blockReason}, from ${existingUser.blockDetails.blockedAt}.`;
        bot.sendPhoto(process.env.ADMIN_CHAT_ID, userProfile.profilePhoto.photoPath, {
          caption: requestMessage,
          reply_markup: {
            inline_keyboard: [
              [
                { text: i18n.__('buttons.approve_unblock'), callback_data: `approve_unblock:${userId}` },
                { text: i18n.__('buttons.reject_unblock'), callback_data: `reject_unblock:${userId}` }
              ]
            ]
          }
        });

        bot.editMessageText(i18n.__('messages.unblock_request_received'), {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: i18n.__('buttons.back'), callback_data: 'back_to_main' }]
            ]
          },
          parse_mode: 'HTML'
        });
      } else if (existingUser && existingUser.isBlocked && existingUser.globalUserState === 'banned') {
        //Логика обработки бана

      } else {
        bot.answerCallbackQuery( callbackQuery.id, {text: i18n.__('messages.not_blocked'), show_alert: false} );
        // bot.editMessageText(i18n.__('messages.not_blocked'), {
        //   chat_id: chatId,
        //   message_id: messageId,
        //   reply_markup: {
        //     inline_keyboard: [
        //       [{ text: i18n.__('buttons.back'), callback_data: 'back_to_main' }]
        //     ]
        //   },
        //   parse_mode: 'HTML'
        // });
      }
      break;
    case 'approve_unblock':
      await User.findOneAndUpdate({ telegramId: targetUserId }, { $set: { globalUserState: 'active', isBlocked: false, blockReason: '', reports: [] } });
      await Profile.findOneAndUpdate({ telegramId: targetUserId }, {$set: { isActive: true }});
      await UserPhoto.findOneAndUpdate({ telegramId: targetUserId }, { $set: { rejectCount: 0 } });
      bot.sendMessage(chatId, `${i18n.__('messages.user_unblocked')} ${targetUserId}`, {parse_mode: 'HTML'} );
      bot.sendMessage(targetUserId, i18n.__('messages.account_unblocked_advice'), {parse_mode: 'HTML'} );
      break;

    case 'reject_unblock':
      bot.sendMessage(chatId, `${i18n.__('messages.unblock_request_denied')} ${targetUserId}`, {parse_mode: 'HTML'} );
      bot.sendMessage(targetUserId, `${i18n.__('messages.unblock_denial_advice')} ${BOT_NAMES.SUPPORT}`, {parse_mode: 'HTML', disable_web_page_preview: true} );
      break;

    case 'subscription':
      const userSubscription = await Subscriptions.findOne({ telegramId: userId });
      let status = userSubscription.isActive ? i18n.__('active_subscription') : i18n.__('inactive_subscription');
      let validity = userSubscription.endDate ? userSubscription.endDate.toLocaleDateString() : '♾️';

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

    // Обработка запросов в техподдержку
    case 'contact_support':
      bot.sendMessage(chatId, i18n.__('messages.request_support'), {
        reply_markup: { force_reply: true } // Принудительный ответ, чтобы получить текст обращения
      });
      break;

    // Обработка отзывов
    case 'feedback':
      bot.sendMessage(chatId, i18n.__('messages.request_feedback'), {
        reply_markup: { force_reply: true } // Принудительный ответ, чтобы получить текст отзыва
      });
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
 } catch (err) {
  console.error('Error callback processing:', err);
  bot.sendMessage(process.env.ADMIN_CHAT_ID, 'Произошла ошибка при обработке колбэк.');
}
});

// Пример обработки принудительного ответа
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  try {
    if (msg.reply_to_message && msg.reply_to_message.text.includes(i18n.__('messages.request_feedback'))) {
      // Проверяем длину сообщения
      if (msg.text.length > 1000) {
        bot.sendMessage(chatId, i18n.__('messages.feedback_too_long'));
        return;
      }
  
      // Сохраняем отзыв в базе данных
      await User.findOneAndUpdate(
        { telegramId: userId },
        { $push: { feedback: { text: msg.text, date: Date.now() } } },
        { upsert: true, new: true }
      )
      bot.sendMessage(process.env.ADMIN_CHAT_ID, `New feedback received from ${userId}:\n${msg.text}`);
      bot.sendMessage(chatId, i18n.__('messages.feedback_thanks'));
    }
  
    if (msg.reply_to_message && msg.reply_to_message.text.includes(i18n.__('messages.request_support'))) {
      // Пересылаем сообщение в чат техподдержки
      bot.forwardMessage(process.env.ADMIN_CHAT_ID, chatId, msg.message_id);
  
      // Отправляем подтверждение пользователю
      bot.sendMessage(chatId, i18n.__('messages.support_request_received'));
    }
  } catch (err) {
    console.error('Error msg:', err);
    bot.sendMessage(process.env.ADMIN_CHAT_ID, 'Произошла ошибка при обработке сообщения.');
  }
});