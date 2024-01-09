// birthdayHandler.js

const i18n = require('i18n');
const handleBirthday = async (bot, userStates, Profile, i18n, msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const birthdayRegex = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;
  
    const currentState = userStates.get(userId);
  
    if (currentState === 'select_birthday' && msg.text) {
      const birthdayText = msg.text.trim();
      const isValidFormat = birthdayRegex.test(birthdayText);
  
      if (isValidFormat) {
        const [fullMatch, day, month, year] = birthdayRegex.exec(birthdayText);
        const birthdayDate = new Date(`${year}-${month}-${day}`);
  
        try {
          const currentDate = new Date();
          const age = currentDate.getFullYear() - birthdayDate.getFullYear();
          const updatedProfile = await Profile.findOneAndUpdate(
            { telegramId: userId },
            { birthday: birthdayDate, age: age },
            { new: true }
          );
  
          console.log('User birthday updated:', updatedProfile);
  
          bot.sendMessage(chatId, i18n.__('birthday_saved'));
          userStates.delete(userId);
        } catch (err) {
          console.error('Error updating user birthday:', err);
          bot.sendMessage(chatId, i18n.__('birthday_not_saved'));
        }
      } else {
        bot.sendMessage(chatId, i18n.__('invalid_birthday_format'));
      }
    }
  };
  
  module.exports = { handleBirthday };  