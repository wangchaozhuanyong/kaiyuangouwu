export const productFields = `
    id
    createdAt
    name
    slug
    description
    featuredAsset { id preview }
    assets { id preview }
    collections { id name slug parentId }
    customFields { fulfillmentType refundPolicy manualDeliverySlaMinutes }
    variants {
        id
        name
        sku
        priceWithTax
        currencyCode
        saleableStockLevel
        autoCardAvailableStock
        featuredAsset { id preview }
        product { id name featuredAsset { id preview } }
        customFields { fulfillmentType digitalDeliveryMode digitalStockPolicy }
    }
`;

export const productPackagingFields = `
    packaging {
        id
        enabled
        autoUnpack
        unitLabel
        packageLabel
        unitsPerPackage
        unitVariant { id name sku }
        packageVariant { id name sku }
    }
`;

export const cartQuoteFields = `
    id
    code
    state
    orderPlacedAt
    totalQuantity
    subTotalWithTax
    shippingWithTax
    totalWithTax
    currencyCode
    customer { id emailAddress }
    payments { id method amount state }
    discounts { description amountWithTax }
    taxSummary { description taxRate taxBase taxTotal }
    couponCodes
    customFields { customerNote deliveryEmail }
    lines {
        id
        quantity
        linePriceWithTax
        proratedUnitPriceWithTax
        productVariant {
            id
            name
            sku
            priceWithTax
            currencyCode
            saleableStockLevel
            autoCardAvailableStock
            featuredAsset { id preview }
            product { id name featuredAsset { id preview } }
            customFields { fulfillmentType digitalDeliveryMode digitalStockPolicy }
        }
        customFields { fulfillmentTypeSnapshot digitalDeliveryModeSnapshot refundPolicySnapshot manualDeliverySlaMinutesSnapshot }
    }
    checkoutFulfillment {
        fulfillmentType
        containsPhysicalProducts
        containsDigitalProducts
        requiresShippingAddress
        requiresShippingMethod
    }
    checkoutShipping {
        methodCode
        methodName
        priceWithTax
        estimateMinDays
        estimateMaxDays
        freeShippingThreshold
        freeShippingApplied
    }
`;

// Delivery and fulfilment records are fetched by order detail routes, not by high-frequency cart edits.
export const orderFields = `${cartQuoteFields}
    fulfillments {
        id
        state
        method
        trackingCode
        createdAt
        updatedAt
    }
    digitalDeliveries {
        orderLineId
        sku
        name
        status
        downloadUrl
        expiresAt
    }
    autoCardDeliveries {
        id
        createdAt
        updatedAt
        state
        productName
        sku
        quantity
        attemptCount
        sentAt
        orderLineId
    }
    manualDigitalDeliveries {
        id
        createdAt
        updatedAt
        state
        productName
        sku
        quantity
        expectedAt
        overdue
        attemptCount
        lastError
        sentAt
        orderLineId
    }
`;

export const customerCouponFields = `
    id
    campaignId
    campaignName
    campaignKind
    status
    minimumSpend
    currencyCode
    discountAmount
    discountRate
    claimedAt
    validFrom
    validUntil
    lockedAt
    usedAt
    returnedAt
    expiredAt
    lockedOrderId
    usedOrderId
    returnCount
    usable
`;

export const referralWalletFields = `
    id
    createdAt
    updatedAt
    currencyCode
    availableBalance
    pendingBalance
    reservedBalance
`;

export const imageGenerationJobFields = `
    id
    createdAt
    updatedAt
    state
    modelCodeSnapshot
    modelNameSnapshot
    officialModelIdSnapshot
    originalPrompt
    finalPrompt
    promptSkillHash
    referenceMode
    aspectRatio
    resolution
    quantity
    unitPriceSnapshot
    reservedAmount
    expectedChargeAmount
    freeQuantityReserved
    freeQuantityCaptured
    paidQuantityReserved
    capturedAmount
    releasedAmount
    currencyCode
    termsVersion
    errorMessage
    completedAt
    referenceAsset { id originalName mimeType byteSize width height expiresAt previewUrl }
    outputs { id outputIndex state attemptCount errorMessage failureCode completedAt refundedAt billingMode chargeAmount width height imageUrl downloadUrl }
`;

// Keep paginated order queries below the production complexity limit. Full order
// details are fetched separately by id when a customer opens an order.
export const orderSummaryFields = `
    id
    code
    state
    orderPlacedAt
    totalQuantity
    totalWithTax
    currencyCode
    fulfillments {
        state
        method
        trackingCode
        updatedAt
    }
    lines {
        id
        quantity
        linePriceWithTax
        productVariant {
            id
            name
            sku
            priceWithTax
            currencyCode
            saleableStockLevel
            autoCardAvailableStock
            featuredAsset { id preview }
            product { id name featuredAsset { id preview } }
            customFields { fulfillmentType digitalDeliveryMode }
        }
        customFields { fulfillmentTypeSnapshot digitalDeliveryModeSnapshot }
    }
    checkoutFulfillment { containsDigitalProducts }
    checkoutShipping { methodName }
`;

export const afterSalesFields = `
    id
    createdAt
    updatedAt
    code
    type
    state
    reason
    description
    currencyCode
    requestedAmount
    approvedAmount
    resolution
    respondedAt
    completedAt
    cancelledAt
    order { id code state }
    items {
        id
        orderLineId
        quantity
        unitPriceWithTax
        lineAmountWithTax
        productName
        sku
        fulfillmentType
    }
    events {
        id
        createdAt
        state
        actorType
        actorLabel
        note
    }
`;

export const storefrontReviewFields = `
    id
    createdAt
    updatedAt
    state
    rating
    title
    body
    customerName
    productName
    sku
    merchantResponse
    moderatedAt
    orderLineId
    productId
    productVariantId
    verifiedPurchase
`;

export const cartFields = `
    id
    revision
    state
    projectedRevision
    totalQuantity
    selectedLineCount
    selectedQuantity
    selectionState
    lines {
        id
        quantity
        selected
        available
        productVariant {
            id
            name
            sku
            priceWithTax
            currencyCode
            saleableStockLevel
            autoCardAvailableStock
            featuredAsset { id preview }
            product { id name featuredAsset { id preview } }
            customFields { fulfillmentType digitalDeliveryMode }
        }
    }
    checkoutOrder { ${cartQuoteFields} }
`;

export const cartResultFields = `
    __typename
    ... on StorefrontCart { ${cartFields} }
    ... on ErrorResult { errorCode message }
`;

export const checkoutResultFields = `
    __typename
    ... on StorefrontCheckoutSession {
        cart { ${cartFields} }
        order { ${orderFields} }
        checkout { id cartRevision state completedAt }
    }
    ... on ErrorResult { errorCode message }
`;
