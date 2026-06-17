FROM public.ecr.aws/k9x5n2l5/shopper-node-20-alpine AS base

RUN mkdir -p /usr/local/share/.config/yarn/global \
    && printf '{"resolutions":{"universal-analytics":"0.5.3"}}' > /usr/local/share/.config/yarn/global/package.json \
    && yarn global add firebase-tools@14.1.0 --ignore-engines

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --ignore-engines --ignore-optional

COPY . .
RUN yarn build

# ── Produção ──────────────────────────────────────────────────────────────────
FROM base AS production

CMD firebase deploy --project $FB_PROJECT_ID --token $FB_DEPLOY_TOKEN --only functions:ticket-assigner
