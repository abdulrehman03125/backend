const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PayPal = require('@paypal/checkout-server-sdk');
const { validatePayment } = require('../middleware/validatePayment');
const { protectRoute } = require('../middleware/auth');
const { createOrder } = require('../controllers/orderController');
const logger = require('../utils/logger');

// Initialize PayPal
let environment = new PayPal.core.SandboxEnvironment(
  process.env.PAYPAL_CLIENT_ID,
  process.env.PAYPAL_CLIENT_SECRET
);
let paypalClient = new PayPal.core.PayPalHttpClient(environment);

// Create Stripe Payment Intent
router.post('/create-payment-intent', protectRoute, validatePayment, async (req, res) => {
  try {
    const { amount, currency, paymentMethodId } = req.body;

    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method: paymentMethodId,
      confirm: true,
      return_url: `${process.env.FRONTEND_URL}/payment/confirm`,
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    logger.error('Stripe payment intent error:', error);
    res.status(500).json({
      error: {
        message: error.message,
        code: error.code,
      },
    });
  }
});

// Create PayPal Order
router.post('/create-paypal-order', protectRoute, validatePayment, async (req, res) => {
  try {
    const { amount, currency } = req.body;

    const request = new PayPal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount.toString(),
        }
      }]
    });

    const order = await paypalClient.execute(request);
    res.json({
      orderId: order.result.id,
    });
  } catch (error) {
    logger.error('PayPal order creation error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to create PayPal order',
        details: error.message,
      },
    });
  }
});

// Capture PayPal Payment
router.post('/capture-paypal-payment', protectRoute, async (req, res) => {
  try {
    const { orderId } = req.body;
    const request = new PayPal.orders.OrdersCaptureRequest(orderId);
    const capture = await paypalClient.execute(request);

    if (capture.result.status === 'COMPLETED') {
      // Create order in your system
      await createOrder({
        userId: req.user.id,
        paymentId: orderId,
        paymentMethod: 'paypal',
        status: 'confirmed',
      });

      res.json({
        success: true,
        captureId: capture.result.id,
      });
    } else {
      throw new Error('Payment not completed');
    }
  } catch (error) {
    logger.error('PayPal payment capture error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to capture PayPal payment',
        details: error.message,
      },
    });
  }
});

// Handle Google Pay
router.post('/create-google-pay-payment', protectRoute, validatePayment, async (req, res) => {
  try {
    const { amount, currency, paymentData } = req.body;

    // Create a payment method using the Google Pay payment data
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        token: paymentData.token,
      },
    });

    // Create a payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method: paymentMethod.id,
      confirm: true,
      return_url: `${process.env.FRONTEND_URL}/payment/confirm`,
    });

    res.json({
      success: true,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    logger.error('Google Pay payment error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to process Google Pay payment',
        details: error.message,
      },
    });
  }
});

// Webhook handler for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        await handleSuccessfulPayment(paymentIntent);
        break;
      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        await handleFailedPayment(failedPayment);
        break;
      default:
        logger.info(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handleSuccessfulPayment(paymentIntent) {
  try {
    await createOrder({
      userId: paymentIntent.metadata.userId,
      paymentId: paymentIntent.id,
      paymentMethod: 'card',
      status: 'confirmed',
    });
  } catch (error) {
    logger.error('Error handling successful payment:', error);
    throw error;
  }
}

async function handleFailedPayment(paymentIntent) {
  try {
    logger.error('Payment failed:', {
      paymentIntentId: paymentIntent.id,
      error: paymentIntent.last_payment_error,
    });
    // Implement your failed payment handling logic here
  } catch (error) {
    logger.error('Error handling failed payment:', error);
    throw error;
  }
}

module.exports = router;
