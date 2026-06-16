FROM public.ecr.aws/k9x5n2l5/shopper-node-20-alpine AS base

RUN yarn global add firebase-tools@14.1.0

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines --ignore-optional

COPY . .
RUN yarn build

# ── Produção ──────────────────────────────────────────────────────────────────
FROM base AS production

CMD firebase deploy --project $FB_PROJECT_ID --token $FB_DEPLOY_TOKEN --only functions:ticketAssigner
