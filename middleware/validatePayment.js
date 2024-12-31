const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Validation rules for different payment methods
const stripePaymentRules = [
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('currency').isString().isLength({ min: 3, max: 3 }).withMessage('Invalid currency code'),
  body('paymentMethodId').isString().notEmpty().withMessage('Payment method ID is required'),
];

const paypalPaymentRules = [
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('currency').isString().isLength({ min: 3, max: 3 }).withMessage('Invalid currency code'),
];

const googlePayPaymentRules = [
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('currency').isString().isLength({ min: 3, max: 3 }).withMessage('Invalid currency code'),
  body('paymentData').isObject().withMessage('Invalid payment data'),
  body('paymentData.token').isString().notEmpty().withMessage('Payment token is required'),
];

// Rate limiting configuration
const rateLimits = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
};

// Validate payment based on payment method
const validatePayment = async (req, res, next) => {
  try {
    const { method } = req.body;
    let validationRules;

    switch (method) {
      case 'card':
        validationRules = stripePaymentRules;
        break;
      case 'paypal':
        validationRules = paypalPaymentRules;
        break;
      case 'google_pay':
        validationRules = googlePayPaymentRules;
        break;
      default:
        return res.status(400).json({
          error: {
            message: 'Invalid payment method',
          },
        });
    }

    // Apply validation rules
    await Promise.all(validationRules.map(validation => validation.run(req)));

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          message: 'Validation error',
          details: errors.array(),
        },
      });
    }

    // Validate amount limits
    const { amount } = req.body;
    if (amount <= 0 || amount > 999999) {
      return res.status(400).json({
        error: {
          message: 'Invalid amount',
          details: 'Amount must be between 0 and 999,999',
        },
      });
    }

    // Additional security checks
    if (!req.secure && process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: {
          message: 'Payment must be processed over HTTPS',
        },
      });
    }

    next();
  } catch (error) {
    logger.error('Payment validation error:', error);
    res.status(500).json({
      error: {
        message: 'Payment validation failed',
        details: error.message,
      },
    });
  }
};

module.exports = {
  validatePayment,
  rateLimits,
};
