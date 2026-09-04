# 条款内容发布草案

> 适用站点：`moyaoai.com` 对应的中英文全球独立站。<br>
> 业务范围：实物商品、数字商品（自动发卡、文件下载、人工数字服务）、账户、订单、支付、配送、优惠券、评价和售后。<br>
> 性质：待完善草案，不是法律意见。法定经营主体、注册国家/地区、客服邮箱和隐私邮箱由后台“店铺资料”统一配置，下文令牌在前台自动替换。补齐并由经营主体所在地的专业人士复核前不得发布。

## 发布前必须确认的信息

- 经营主体：{{legalEntityName}}。
- 注册国家/地区：{{legalRegistrationCountry}}；按经营者要求不在本文公开注册地址。
- 客服邮箱：{{supportEmail}}；隐私邮箱：{{privacyEmail}}。
- 退货地址：不设置统一公开地址，消费者应先联系客服获取适用于具体订单的退货地址。
- 适用法律与争议管辖：中国法律及中国境内依法有管辖权的机构。
- 真实支付服务商、物流服务商、邮件服务商及实际数据存储地。
- 项目当前运行资料显示主服务器位于日本东京，并使用 Cloudflare 和 Resend。如果面向中国大陆用户，发布前必须补充境外接收方、联系方式、处理目的、信息种类和用户权利行使方式，并完成必要的单独同意及数据出境合规手续。

## 后台模块基础字段

| 字段         | 中文                                                                                                                                                                   | English                                                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模块内部名称 | 条款与隐私政策                                                                                                                                                         | Legal and privacy policies                                                                                                                                                                                                                                                |
| 区块编码     | `storefront-legal`                                                                                                                                                     | `storefront-legal`                                                                                                                                                                                                                                                        |
| 模块标题     | 服务与政策                                                                                                                                                             | Service and policies                                                                                                                                                                                                                                                      |
| 副标题       | 请在注册或下单前阅读与您权益相关的文件                                                                                                                                 | Please review the documents relevant to your rights before registering or ordering                                                                                                                                                                                        |
| 模块正文     | 本模块包含本站的隐私政策和使用条款。如果商品详情页、订单页或单独政策对配送、交付或售后有更具体的说明，该说明与本条款共同适用；与强制性法律规定冲突的，以法律规定为准。 | This module contains the site's Privacy Policy and Terms of Use. More specific delivery, fulfilment, or after-sales information shown on a product page, order page, or separate policy applies together with these terms. Mandatory law prevails if there is a conflict. |

---

## 条目一：隐私政策

### 条目配置

- 启用：是
- 跳转类型：`PAGE`
- 跳转目标：`/legal?id=privacy`
- 中文名称：隐私政策
- English label: Privacy Policy

### 中文正文

生效日期：2026年8月26日
最近更新：2026年8月26日

1. 适用范围和责任主体

本隐私政策适用于您访问 moyaoai.com 及其对应店铺、注册账户、浏览或购买实物商品和数字商品、使用支付、交付、售后、评价及客服功能的过程。个人信息处理者为 {{legalEntityName}}，注册国家/地区为 {{legalRegistrationCountry}}（以下简称“我们”）。

2. 我们处理的信息

（1）账户信息：姓名、电子邮箱、手机号码、经安全处理的密码验证数据、账户验证状态和账户安全记录。

（2）订单和交易信息：购物车、商品、SKU、数量、价格、币种、优惠券、订单状态、支付状态、退款和对账记录。如使用第三方支付，完整银行卡号等支付凭证通常由支付服务商直接处理，我们仅接收完成交易所需的支付状态、金额和参考编号，除非结算页另有明示。

（3）实物商品履约信息：收件人、联系电话、国家或地区、省市、详细地址、邮政编码、配送方式和物流记录。

（4）数字商品履约信息：数字交付邮箱、交付模式（自动发卡、文件下载或人工数字服务）、交付状态、下载或领取记录。为了保护数字内容，我们可使用有效期较短的安全链接和访问令牌。

（5）售后、评价和客服信息：退货退款理由、问题描述、证明材料、沟通记录、商品评分、评价内容和处理结果。

（6）设备、日志和安全信息：IP 地址、浏览器和设备类型、访问时间、页面请求、错误日志、会话标识和安全事件。

（7）偏好和浏览信息：语言偏好、收藏商品、当前店铺最近浏览的商品标识（最多 20 个）以及根据最近订单和浏览商品分类形成的简单推荐结果。当前推荐主要基于商品分类匹配，不使用敏感个人信息进行推断。

3. 使用信息的目的和依据

我们为创建和管理账户、展示商品、处理购物车和订单、完成支付、配送和数字交付、发送必要的账户与交易邮件、处理优惠券、售后、评价和客服请求、防止欺诈和滥用、保障系统安全、遵守会计税务及其他法定义务而处理必要信息。我们将根据您的同意、订立或履行合同的必要、法定义务及适用法律允许的其他合法基础处理信息。

我们不会仅因您不同意非必要处理而拒绝提供基本商品浏览功能。如我们日后开展营销邮件、广告跟踪或与交易无关的分析，将在启用前提供额外告知和必要选择。

4. Cookie、本地存储和类似技术

我们使用会话标识、Cookie 或浏览器本地存储来维持登录状态、识别当前店铺、保存语言偏好、收藏和浏览足迹，并提供安全防护。其中部分信息仅保存在您的设备上。您可以通过账户页面清除收藏或浏览足迹，也可以通过浏览器删除本地数据；删除必要存储可能使您退出登录或需要重新设置偏好。

5. 信息共享和委托处理

我们仅在完成服务所必需的范围内，向以下类型的接收方提供信息：实际销售商或履约商、支付和反欺诈服务商、物流与仓储服务商、数字交付和邮件服务商、云计算、CDN、安全、备份及监控服务商，以及依法有权的政府、司法或监管机构。我们要求服务商仅按约定目的处理信息并采取合理安全措施。我们不会出售您的个人信息。

6. 跨境处理

本站面向多个国家和地区，云服务、安全、邮件、支付或配送服务可能导致信息在您所在地以外处理。在发生跨境提供前，我们将按适用法律告知接收方、联系方式、处理目的和方式、信息种类以及您行使权利的方式，并在法律要求时取得单独同意、完成影响评估或采用其他合法传输机制。

7. 保存期限

我们仅在实现本政策所述目的和满足会计、税务、电子商务、消费者权益、争议处理及安全义务所必需的期间保存信息。如中国电子商务法适用，商品和服务信息、交易信息自交易完成之日起保存不少于三年，法律另有规定的从其规定。超出必要期限后，我们将删除、匿名化或以其他合法方式处理，但法律要求继续保存或为解决争议所必需的除外。

8. 您的权利

根据适用法律，您可能有权知情、查阅、复制、更正、补充、删除或转移个人信息，撤回同意，限制或反对某些处理，获得处理规则解释，以及向有管辖权的监管机构投诉。您可在账户页管理部分资料、地址、收藏和浏览足迹，或通过 {{privacyEmail}} 提交请求。为保护账户安全，我们可在处理请求前验证您的身份。

如您不希望我们使用最近浏览记录进行推荐，可先清除浏览足迹；如需要完全退出基于订单的个性化推荐，请通过 {{privacyEmail}} 联系我们。

9. 安全措施

我们采取与风险相匹配的管理、技术和物理措施，包括访问控制、传输加密、安全日志、最小权限、备份和安全更新等。但任何网络或存储方式都无法保证绝对安全。如发生可能影响您权益的安全事件，我们将按适用法律采取补救和通知措施。

10. 未成年人

本站不以未满 14 周岁的儿童为主要服务对象，也不会在明知的情况下未经监护人同意处理其个人信息。如您认为儿童未经适当同意向我们提供了信息，请通过 {{privacyEmail}} 联系我们。

11. 政策更新

我们可能根据服务、技术或法律变化更新本政策，并在本页标示最近更新日期。如更新对您的权益有重大影响，我们将在法律要求的范围内以显著方式告知并重新取得必要同意。

12. 联系我们

个人信息处理者：{{legalEntityName}}
注册国家/地区：{{legalRegistrationCountry}}
隐私联系邮箱：{{privacyEmail}}
客服邮箱：{{supportEmail}}

### English body

Effective date: August 26, 2026
Last updated: August 26, 2026

1. Scope and controller

This Privacy Policy applies when you visit moyaoai.com and its associated storefronts, create an account, browse or purchase physical or digital products, or use payment, fulfilment, after-sales, review, and support features. The controller responsible for your personal data is {{legalEntityName}}, registered in {{legalRegistrationCountry}} ("we", "us", or "our").

2. Information we process

(1) Account information: name, email address, phone number, securely processed password-verification data, verification status, and account-security records.

(2) Order and transaction information: cart contents, products, SKUs, quantities, prices, currencies, coupons, order status, payment status, refunds, and reconciliation records. When a third-party payment provider is used, full payment credentials such as card numbers are generally processed directly by that provider. Unless clearly stated at checkout, we receive only the status, amount, and reference information needed to complete the transaction.

(3) Physical fulfilment information: recipient name, phone number, country or region, province or state, city, street address, postal code, shipping method, and tracking events.

(4) Digital fulfilment information: delivery email, delivery method (automatic credential delivery, file download, or manually fulfilled digital service), fulfilment status, and download or redemption events. Short-lived secure links and access tokens may be used to protect digital content.

(5) After-sales, reviews, and support: return or refund reasons, issue descriptions, evidence, communications, product ratings, review content, and outcomes.

(6) Device, log, and security information: IP address, browser and device type, access times, page requests, error logs, session identifiers, and security events.

(7) Preferences and browsing information: language, favourites, up to 20 recently viewed product identifiers for the current store, and simple recommendations derived from the categories of recent orders and viewed products. Recommendations currently use category matching and do not infer sensitive personal data.

3. Purposes and legal bases

We process information as necessary to create and manage accounts; display products; operate carts and orders; complete payments, shipping, and digital delivery; send essential account and transaction emails; administer coupons, after-sales requests, reviews, and support; prevent fraud and abuse; secure the service; and meet accounting, tax, e-commerce, and other legal obligations. Depending on the context and applicable law, processing is based on your consent, the necessity to enter into or perform a contract with you, compliance with legal obligations, or another lawful basis.

We will not deny basic product-browsing functionality merely because you decline non-essential processing. If we later introduce marketing email, advertising tracking, or analytics unrelated to transactions, we will provide additional notice and any choices required before enabling it.

4. Cookies, local storage, and similar technologies

We use session identifiers, cookies, or browser local storage to maintain sign-in, identify the current store, save language preferences, favourites and browsing history, and provide security protections. Some of this information remains only on your device. You may clear favourites or browsing history through available account features or delete local data through your browser. Deleting necessary storage may sign you out or reset preferences.

5. Sharing and processors

We disclose information only to the extent needed to provide the service, including to the actual seller or fulfilment party; payment and fraud-prevention providers; shipping and warehousing providers; digital-delivery and email providers; cloud hosting, CDN, security, backup, and monitoring providers; and government, judicial, or regulatory authorities where legally required. We require service providers to process information only for agreed purposes and to use reasonable safeguards. We do not sell your personal data.

6. International processing

Because the site serves multiple countries and regions, cloud, security, email, payment, or shipping services may process information outside your location. Before making a regulated international transfer, we will provide information required by applicable law about the recipient, contact details, purposes, methods, data categories, and how you may exercise your rights. Where required, we will obtain separate consent, conduct an impact assessment, or use another lawful transfer mechanism.

7. Retention

We retain information only for as long as needed for the purposes described above and to satisfy accounting, tax, e-commerce, consumer-protection, dispute-resolution, and security obligations. Where Chinese e-commerce law applies, product, service, and transaction records will be kept for at least three years after the transaction is completed, or longer where law requires. When information is no longer required, we delete, anonymise, or otherwise lawfully dispose of it unless continued retention is required by law or necessary for a dispute.

8. Your rights

Subject to applicable law, you may have rights to be informed; access, copy, correct, supplement, delete, or port personal data; withdraw consent; restrict or object to processing; obtain an explanation of processing rules; and complain to a competent authority. Some account information, addresses, favourites, and browsing history can be managed through the account area. Other requests may be submitted to {{privacyEmail}}. We may verify your identity before acting on a request.

You may clear browsing history if you do not want recent views used for recommendations. To opt out fully from recommendations based on order history, contact {{privacyEmail}}.

9. Security

We use administrative, technical, and physical measures appropriate to the risk, including access controls, encryption in transit, security logging, least privilege, backups, and security updates. No network or storage system is completely secure. If a security incident may materially affect your rights, we will take remedial and notification steps required by applicable law.

10. Children

The site is not directed primarily to children under 14, and we do not knowingly process their personal data without appropriate guardian consent. If you believe a child provided information without appropriate consent, contact {{privacyEmail}}.

11. Changes

We may update this Policy when our services, technology, or legal obligations change and will show the latest update date on this page. If a change materially affects your rights, we will provide prominent notice and obtain renewed consent where required.

12. Contact

Controller: {{legalEntityName}}
Country/region of registration: {{legalRegistrationCountry}}
Privacy email: {{privacyEmail}}
Customer support email: {{supportEmail}}

---

## 条目二：使用条款

### 条目配置

- 启用：是
- 跳转类型：`PAGE`
- 跳转目标：`/legal?id=terms`
- 中文名称：使用条款
- English label: Terms of Use

### 中文正文

生效日期：2026年8月26日
最近更新：2026年8月26日

1. 条款的接受和经营者信息

本站由 {{legalEntityName}} 运营，注册国家/地区为 {{legalRegistrationCountry}}。您访问本站、注册账户、提交订单或使用相关服务，表示您已阅读并同意受本条款约束。如果您不同意，请不要注册或下单。任何格式条款均不排除或限制您根据适用法律不得被排除的消费者权利。

您应已达到所在地签订相应合同的法定年龄和民事行为能力；未满法定年龄的用户应在监护人同意和指导下使用本站。

2. 账户和安全

您应提供真实、准确、完整且当前有效的资料，妥善保管密码、邮箱、验证码和数字商品领取链接。除法律另有规定外，您对在其账户下进行的操作负责。如发现未授权使用、凭证泄露或其他安全风险，请立即更改可用凭证并通过 {{supportEmail}} 联系我们。

3. 商品和服务信息

我们将尽合理努力准确展示商品或服务的名称、规格、兼容性、账户或地区要求、交付方式、价格、税费、库存和售后条件。商品详情、结算页和订单确认页中对具体商品的说明是交易约定的组成部分。

某些数字商品或服务由第三方品牌或平台提供技术能力。您还应遵守对应第三方的合法条款，并在购买前核对设备、账户、地区、语言和使用资格。第三方政策或服务状态变化不会排除我们对已作出的明示承诺以及适用法律下商品或服务质量问题应承担的责任。

4. 价格、税费、优惠和支付

您应付的币种、商品价款、折扣、运费、税费和应付总额以提交订单前的结算页为准。银行或支付机构可能收取汇率转换或其他费用，该费用不由我们控制。

优惠券、满减和限时活动按页面公布的使用门槛、有效期、适用商品和每人限制执行，不得兑换现金。发生合法退款时，退款以您实际支付的金额及适用法律为准，优惠券是否返还按该活动规则处理。

5. 订单和合同成立

提交订单前，您应核对商品、数量、币种、价格、收货信息、数字交付邮箱和交付方式。订单提交和合同成立时点按结算页提示及适用法律确定；我们不会以格式条款任意规定您支付后合同仍未成立。

如因明显价格或系统错误、库存不足、无法履约、欺诈或违法风险必须拒绝或取消订单，我们将尽快通知您，并对已收取但不应继续保留的金额按原路或法律允许的方式退还。

6. 实物商品配送

可配送国家或地区、运费和预计时效以结算页显示为准。预计时效可能受海关、假期、天气、承运人或其他合理范围外因素影响。您应提供完整准确且可签收的地址和联系方式，收到商品后应及时检查外包装、数量和明显损坏，并在合理时间内联系客服。运输风险和责任按适用法律处理，不会仅因物流交接而不当转移给消费者。

7. 数字商品和数字服务交付

数字商品的交付方式以商品页和订单页为准：

（1）自动发卡：付款成功后，通过订单详情、安全领取页或交付邮箱提供兑换码、凭证或相关内容。

（2）文件下载：付款成功且订单进入可交付状态后，提供可能具有有效期的安全下载链接。

（3）人工数字服务：由客服或服务人员在商品页承诺的时间和方式内完成交付。

您应在购买前核对接收邮箱、地区、设备、账户、软硬件兼容性、有效期和其他明示限制。不得出售、公开或以其他方式泄露仅授权给您的下载链接、兑换码或凭证。

8. 取消、退货、退款和瑕疵救济

实物商品的无理由退货、质量问题、换货、维修和退款按商品页明示的售后规则及适用法律处理。我们不会擅自扩大法定不适用无理由退货的商品范围；如商品依法不适用无理由退货，应在购买前以显著方式标注并由您主动确认。

对于非有形载体的数字内容或已开始履行的数字服务，无理由取消或退货权可能在适用法律允许、我们已经在购买前明确告知，并且您主动同意立即交付且确认相应权利变化后受到限制。我们不会把“数字商品一律不退款”作为默认同意的格式条款。

如数字商品未交付、交付错误、无法在明示条件下使用，或与商品页承诺严重不符，请及时联系客服。我们将根据问题情况和适用法律采取重新交付、修复、替换、减价、取消或退款等救济。

9. 评价和用户内容

您提交的评价、图片和其他内容应当真实、合法、与实际交易相关，不得侵害他人知识产权、隐私、名誉或其他合法权益，不得包含欺诈、恶意、侮辱、违法或广告垃圾内容。您授予我们在运营本站、展示评价和处理争议所必需的非独家、免费使用权，您仍保留对原内容享有的权利。

10. 禁止行为

您不得使用本站从事违法活动，侵害他人权益，伪造身份或交易，恶意下单、退款或套取优惠，干扰网站或接口正常运行，未经允许批量抓取数据，尝试绕过安全控制，传播恶意代码，或未经授权转售、共享数字交付内容。我们可在合理证据支持下采取风险控制、拒绝违法交易、保护账户或暂停相关功能，但不会以此排除用户的法定救济权利。

11. 知识产权

本站的软件、页面设计、商标、文案、图像及其他内容受适用知识产权法保护，归相应权利人所有。未经授权，不得复制、修改、散布、公开传播或用于商业用途。您购买数字商品取得的是商品页明示范围内的使用许可，而非相关知识产权的转让，除非商品页另有明确说明。

12. 服务可用性和责任边界

我们将尽合理努力保障本站安全稳定运行，但可能因维护、安全事件、网络故障、上游服务变化或不可抗力暂时中断。在适用法律允许的最大范围内，我们仅对可合理预见并由我们违约或过错直接导致的损失承担责任。本条不限制因故意或重大过失、人身伤害、欺诈、消费者法定权利或法律禁止限制的其他责任。

13. 条款变更和服务终止

我们可能因功能、业务或法律变化更新本条款。对您权益有重大影响的变更，我们将按适用法律以显著方式通知，并不会不当剥夺变更前已形成的权利。如我们终止网站或相关服务，将按法律要求提前公告，处理未履行订单、必要数据导出和应退费用。

14. 适用法律和争议解决

本条款适用中华人民共和国法律，但该选择不会剥夺您居住地强制性消费者保护。发生争议时，请先通过 {{supportEmail}} 与我们协商。协商不成的，可向依法有管辖权的消费者保护、监管、调解或司法机构寻求救济；如法律允许当事人约定管辖，由中国境内依法有管辖权的人民法院管辖。

15. 联系我们

经营主体：{{legalEntityName}}
注册国家/地区：{{legalRegistrationCountry}}
退货地址：请先通过客服邮箱联系我们，根据具体订单和商品类型获取适用的退货地址；未经确认请勿自行寄回。
客服邮箱：{{supportEmail}}

### English body

Effective date: August 26, 2026
Last updated: August 26, 2026

1. Acceptance and operator information

This site is operated by {{legalEntityName}}, registered in {{legalRegistrationCountry}}. By accessing the site, creating an account, placing an order, or using related services, you acknowledge that you have read and agree to these Terms. If you do not agree, do not register or place an order. Nothing in these standard terms excludes or restricts consumer rights that cannot lawfully be excluded.

You must have the legal age and capacity required to enter the relevant contract where you live. Users below that age may use the site only with the consent and guidance of a parent or legal guardian.

2. Accounts and security

You must provide information that is truthful, accurate, complete, and current and protect your password, email account, verification codes, and digital-delivery links. Except where law provides otherwise, you are responsible for activity conducted through your account. If you discover unauthorised access, credential exposure, or another security risk, change available credentials promptly and contact us at {{supportEmail}}.

3. Product and service information

We use reasonable efforts to describe product and service names, specifications, compatibility, account or regional requirements, delivery method, price, tax, availability, and after-sales conditions accurately. Product-page, checkout, and order-confirmation information specific to an item forms part of the transaction terms.

Some digital products or services rely on technology supplied by third-party brands or platforms. You must also comply with lawful third-party terms and confirm device, account, region, language, and eligibility requirements before purchase. Changes to a third party's policies or service status do not remove our responsibility for express promises we made or for defects for which we remain responsible under applicable law.

4. Prices, taxes, promotions, and payment

The currency, item price, discount, shipping charge, tax, and total payable shown at checkout before order submission apply to your order. Your bank or payment provider may impose conversion or other charges outside our control.

Coupons and promotions are governed by the displayed eligibility, expiry, applicable-item, and per-customer rules and cannot be exchanged for cash. A lawful refund is based on the amount actually paid and applicable law. Coupon reinstatement follows the campaign rules.

5. Orders and contract formation

Before submitting an order, verify the products, quantity, currency, price, shipping details, digital-delivery email, and fulfilment method. The timing of order submission and contract formation is determined by checkout disclosures and applicable law. We do not use these terms to state arbitrarily that no contract exists after payment.

If an order must be rejected or cancelled because of an obvious pricing or system error, lack of stock, inability to perform, fraud, or legal risk, we will notify you promptly and return amounts collected that we are not entitled to retain through the original method or another lawful method.

6. Physical-product shipping

Available destinations, shipping charges, and estimates are shown at checkout. Estimates may be affected by customs, holidays, weather, carriers, or events reasonably outside our control. You must provide a complete, accurate, deliverable address and contact details. Inspect packaging, quantity, and visible damage promptly after delivery and contact support within a reasonable time. Shipping risk and responsibility are governed by applicable law and are not improperly transferred to a consumer merely by a logistics hand-off.

7. Digital products and services

The applicable delivery method is shown on the product and order pages:

(1) Automatic credential delivery: after successful payment, a redemption code, credential, or related content is provided through order details, a secure retrieval page, or the delivery email.

(2) File download: after successful payment and the order reaches a deliverable state, a secure download link, which may expire, is provided.

(3) Manually fulfilled digital service: support or service staff completes delivery within the time and method promised on the product page.

Before purchase, verify the receiving email, region, device, account, software or hardware compatibility, expiry, and other disclosed restrictions. Do not sell, publish, or otherwise expose a download link, redemption code, or credential licensed only to you.

8. Cancellation, returns, refunds, and remedies

No-reason returns, defects, exchanges, repairs, and refunds for physical goods are handled under the after-sales rules clearly displayed for the product and applicable law. We do not expand categories excluded from a statutory cooling-off or no-reason return right. Where a product is lawfully excluded, it must be prominently identified before purchase and actively confirmed by you where required.

For digital content not supplied on a tangible medium or a digital service whose performance has begun, a no-reason cancellation right may be limited only where applicable law permits, we clearly informed you before purchase, and you expressly requested immediate performance and acknowledged the resulting change to that right. We do not treat "all digital products are non-refundable" as a default standard term.

If digital content is not delivered, is delivered incorrectly, cannot be used under the disclosed requirements, or materially fails to match the product promise, contact support promptly. Depending on the issue and applicable law, available remedies may include re-delivery, repair, replacement, price reduction, cancellation, or refund.

9. Reviews and user content

Reviews, images, and other content you submit must be truthful, lawful, related to the transaction, and must not infringe intellectual property, privacy, reputation, or other rights or contain fraudulent, malicious, abusive, illegal, or spam content. You grant us a non-exclusive, royalty-free licence to use that content as necessary to operate the site, display the review, and resolve disputes. You retain your underlying rights.

10. Prohibited conduct

You must not use the site for unlawful activity; infringe others' rights; misrepresent identity or transactions; abuse orders, refunds, or promotions; interfere with the site or APIs; scrape data at scale without permission; bypass security controls; distribute malicious code; or resell or share digital-delivery content without authorisation. With reasonable evidence, we may apply risk controls, reject unlawful transactions, protect accounts, or suspend relevant functions, without removing statutory remedies.

11. Intellectual property

The site's software, design, marks, copy, images, and other content are protected by applicable intellectual-property law and belong to their respective owners. They may not be copied, modified, distributed, publicly communicated, or commercially exploited without permission. A digital-product purchase grants only the licence disclosed on the product page and does not transfer intellectual-property ownership unless expressly stated.

12. Availability and limits of responsibility

We use reasonable efforts to operate the site securely and reliably, but maintenance, security events, network failure, upstream-service changes, or force majeure may cause interruption. To the maximum extent permitted by law, we are responsible only for reasonably foreseeable loss directly caused by our breach or fault. Nothing limits liability for wilful misconduct or gross negligence, personal injury, fraud, mandatory consumer rights, or any liability that law prohibits us from limiting.

13. Changes and termination

We may update these Terms when features, business operations, or law change. We will provide prominent notice of changes that materially affect your rights as required by law and will not improperly remove rights accrued before the change. If the site or a relevant service is discontinued, we will provide legally required advance notice and address outstanding orders, necessary data access, and refunds due.

14. Governing law and disputes

These Terms are governed by the laws of the People's Republic of China, but that choice does not deprive you of mandatory consumer protections where you live. Contact {{supportEmail}} first so we can attempt to resolve a dispute. If it cannot be resolved, you may seek relief from any consumer-protection, regulatory, mediation, or judicial body with lawful jurisdiction. Where a choice of forum is legally permitted, the dispute will be submitted to a court with lawful jurisdiction in China.

15. Contact

Operator: {{legalEntityName}}
Country/region of registration: {{legalRegistrationCountry}}
Return address: contact customer support first to obtain the return address applicable to the specific order and product type; do not send an item back without confirmation.
Customer support email: {{supportEmail}}

---

## 上线前的产品和合规缺口

1. 当前前台会根据最近订单和浏览分类展示“猜你喜欢”，但没有完整的“关闭个性化推荐”开关。发布前应增加非个性化选项，不应只在政策里承诺。
2. 当前实物/数字商品的退货退款规则没有独立发布页，结算页也没有显著的条款确认步骤。对于依法可排除无理由取消的数字内容，应在购买前单独显示并让用户主动确认。
3. 项目还没有用户自助注销账户功能。隐私政策可先使用邮件申请通道，但必须配置真实可用的隐私邮箱和内部处理流程。
4. 当前生产准备文档显示正式支付、退款和税务规则尚未完成验收。支付服务商、税费和退款文案应在真实方案确定后再定稿。
5. 如果面向欧盟用户，还应根据实际 Cookie/分析工具、法律基础、数据保留表、处理者清单和跨境机制完成 GDPR 专项复核，并根据销售地区核对退货、保修及数字内容取消权。
