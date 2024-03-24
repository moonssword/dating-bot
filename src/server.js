import express from 'express';
import bodyParser from 'body-parser';
import { updateSubscription } from './checkSubscription.js';

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));

app.post('/payment/notification', (req, res) => {
  const {
    status,
    invoice_id,
    order_id,
    amount,
    currency,
    method,
    email
  } = req.body;

  // Обновление данных в базе
  const newData = {
    paymentStatus: status,
    invoiceId: invoice_id,
    amount: amount,
    currency: currency,
    method: method,
    email: email
  };
  updateSubscription(order_id, newData);

  res.sendStatus(200);
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Payment verification server is running on port ${port}`);
});