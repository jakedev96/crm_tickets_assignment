FROM public.ecr.aws/k9x5n2l5/shopper-node-20-alpine AS deps

RUN mkdir -p /usr/local/share/.config/yarn/global \
    && printf '{"resolutions":{"universal-analytics":"0.5.3"}}' > /usr/local/share/.config/yarn/global/package.json \
    && yarn global add firebase-tools@14.1.0 --ignore-engines

WORKDIR /app

ARG DEV_BUILD
RUN test "${DEV_BUILD}" = "1" && apk add --no-cache openjdk17-jre-headless || true

COPY package.json yarn.lock ./
RUN yarn install --ignore-engines --ignore-optional

# ── Build ──────────────────────────────────────────────────────────────────────
FROM deps AS build

COPY . .
RUN yarn build

# ── Produção ──────────────────────────────────────────────────────────────────
FROM build AS production

CMD firebase deploy --project $FB_PROJECT_ID --token $FB_DEPLOY_TOKEN --only functions:crm-functions
