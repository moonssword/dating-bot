// birthdayHandler.js
import i18n from 'i18n';

export
async function handleBirthday(bot, currentUserState, Profile, i18n, msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const birthdayRegex = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;

  const currentState = currentUserState.get(userId);

  if (currentState === 'select_birthday' && msg.text) {
      const birthdayText = msg.text.trim();
      const isValidFormat = birthdayRegex.test(birthdayText);
  
      if (isValidFormat) {
          const [fullMatch, day, month, year] = birthdayRegex.exec(birthdayText);
          const birthdayDate = new Date(`${year}-${month}-${day}`);
          const currentDate = new Date();
          const age = currentDate.getFullYear() - birthdayDate.getFullYear();
  
          if (age >= 5 && age <= 100) {
              try {
                  const updatedProfile = await Profile.findOneAndUpdate(
                      { telegramId: userId },
                      { birthday: birthdayDate, age: age },
                      { new: true }
                  );
  
                  console.log('User birthday updated:', updatedProfile);
  
                  const savedMessage = await bot.sendMessage(chatId, i18n.__('birthday_saved'));
                  setTimeout(async () => {
                      try {
                          await bot.deleteMessage(chatId, savedMessage.message_id);
                          await bot.sendMessage(chatId, i18n.__('request_photo_message_text'));
                      } catch (error) {
                          console.error('Error:', error);
                      }
                  }, 2000);
                  currentUserState.set(userId, 'select_photo');
              } catch (err) {
                  console.error('Error updating user birthday:', err);
                  bot.sendMessage(chatId, i18n.__('birthday_not_saved')); //Отладка
              }
          } else {
            const errorMessage = await bot.sendMessage(chatId, i18n.__('invalid_birthday_format'));
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, errorMessage.message_id);
                } catch (error) {
                    console.error('Error:', error);
                }
            }, 3000);
          }
      } else {
        const errorMessage = await bot.sendMessage(chatId, i18n.__('invalid_birthday_format'));
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, errorMessage.message_id);
            } catch (error) {
                console.error('Error:', error);
            }
        }, 3000);
      }
  }
};

export default { handleBirthday };