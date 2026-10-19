<template>
  <div class="af-signup-page relative flex items-center justify-center min-h-screen bg-lightHtml dark:bg-darkHtml w-screen h-screen"
    :style="coreStore.config?.loginBackgroundImage && backgroundPosition === 'over' ? {
      'background-image': 'url(' + loadFile(coreStore.config?.loginBackgroundImage) + ')',
      'background-size': 'cover',
      'background-position': 'center',
      'background-blend-mode': 'darken'
    }: {}"
  >
    
    <img v-if="coreStore.config?.loginBackgroundImage && backgroundPosition !== 'over'"
      :src="loadFile(coreStore.config?.loginBackgroundImage)"
      class="position-absolute top-0 left-0 h-screen object-cover w-0"
      :class="{
        '1/2': 'md:w-1/2',
        '1/3': 'md:w-1/3',
        '2/3': 'md:w-2/3',
        '3/4': 'md:w-3/4',
        '2/5': 'md:w-2/5',
        '3/5': 'md:w-3/5',
      }[backgroundPosition]"
    />

    <!-- Main modal -->
    <div id="authentication-modal" tabindex="-1" 
      class="af-signup-modal overflow-y-auto flex flex-grow
      overflow-x-hidden z-50 min-w-[350px]  justify-center items-center md:inset-0 h-[calc(100%-1rem)] max-h-full">
        <div class="relative p-4 w-full max-h-full max-w-[400px]">
            <DialogPanel
              class="af-login-popup max-w-none bg-lightLoginViewBackground dark:bg-darkLoginViewBackground"
              :title="`${$t('Sign up into')} ${coreStore.config?.brandName}`"
              :error="!requestSent ? validationError || error : null"
              :classes="{ title: 'text-lightLoginViewTextColor dark:text-darkLoginViewTextColor' }"
            >
                  <form v-if="!requestSent" class="space-y-4" role="alert" @submit.prevent>
                    <div v-if="!verifyToken" class="relative">
                      <label for="email" class="block mb-2 text-sm font-medium text-lightLoginViewTextColor dark:text-darkLoginViewTextColor">{{$t('Your email address')}}</label>
                      <Input type="email" name="email" id="email"
                        tabindex="1"
                        autocomplete="username"
                        @keydown.enter="passwordInput?.focus()"
                        ref="emailInput"
                        v-model="email"
                        class="w-full"
                        placeholder="name@company.com" 
                        required
                      />
                    </div>
                    <div v-if="isPasswordNeeded" class="relative">
                      <label for="password" class="block mb-2 text-sm font-medium text-lightLoginViewTextColor dark:text-darkLoginViewTextColor">{{$t('Your password')}}</label>
                      <Input
                        tabindex="2"
                        autocomplete="new-password"
                        ref="passwordInput"
                        type="password"
                        passwordToggle
                        name="password" id="password"
                        v-model="password"
                        @keydown.enter="passwordConfirmationInput?.focus()"
                        :placeholder="$t('New password')" 
                        class="w-full"
                        required
                      />
                    </div>

                    <div v-if="isPasswordNeeded" class="relative">
                      <label for="password_confirmation" class="block mb-2 text-sm font-medium text-lightLoginViewTextColor dark:text-darkLoginViewTextColor">{{$t('Confirm your password')}}</label>
                      <Input
                        type="password"
                        passwordToggle
                        name="password_confirmation"
                        id="password_confirmation"
                        tabindex="3"
                        ref="passwordConfirmationInput"
                        autocomplete="new-password"
                        v-model="passwordConfirmation"
                        class="w-full"
                        :placeholder="$t('Confirm new password')" 
                        required
                      />
                    </div>

                    <Button
                      :disabled="inProgress || (validationRunning && validationError)"
                      @click="() => verifyToken ? signupAfterEmailConfirmation() : doSignup()"
                      type="submit"
                      class="w-full"
                      :loader="inProgress"
                    >
                      {{$t('Sign up')}}
                    </Button>
                  </form>
<!-- END of set new password -->
                  <div v-else class="af-alert-success flex items-start gap-2.5 rounded-lg border border-lightSuccessBorder bg-lightSuccessSoft px-3.5 py-3 text-sm leading-5 text-lightSuccess dark:border-darkSuccessBorder dark:bg-darkSuccessSoft dark:text-darkSuccess" role="status">
                    <IconMailCheck class="w-5 h-5 shrink-0" aria-hidden="true" />
                    {{$t('Please check your email at')}} {{ sentToEmail }} {{$t('to confirm your email address.')}}
                  </div> 
                  <p class="af-signup-login-link text-sm text-right -mt-1 text-lightLoginViewSubTextColor dark:text-darkLoginViewSubTextColor">
                      {{$t('Already have an account?')}} <Link :to="`/login${route.query.next ? `?next=${encodeURIComponent(route.query.next)}` : ''}`">{{ $t('login here') }}</Link>
                  </p>
            </DialogPanel>
        </div>
    </div> 

  </div>
</template>


<script setup lang="ts">
import { onMounted, ref, computed, Ref, onBeforeMount, nextTick } from 'vue';
import { useCoreStore } from '@/stores/core';
import { useUserStore } from '@/stores/user';
import { callAdminForthApi, loadFile, applyRegexValidation } from '@/utils';
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { IconMailCheck } from '@iconify-prerendered/vue-lucide';
import { Button, DialogPanel, Input, Link } from '@/afcl';
import { useI18n } from 'vue-i18n';
import adminforth from '@/adminforth';

const { t } = useI18n();

const inProgress = ref(false);

const coreStore = useCoreStore();
const requestSent = ref(false);

const emailInput: Ref<HTMLInputElement | null> = ref(null);
const passwordInput: Ref<HTMLInputElement | null> = ref(null);
const passwordConfirmationInput: Ref<HTMLInputElement | null> = ref(null);

const email = ref("");
const password = ref("");
const passwordConfirmation = ref("");
const sentToEmail: Ref<string> = ref('');

const requestEmailConfirmation = computed(() => route.meta.requestEmailConfirmation);
const verifyToken = computed(() => route.query.token);
const isPasswordNeeded = computed(() => !requestEmailConfirmation.value || (requestEmailConfirmation.value && verifyToken.value));

const user = useUserStore();

const route = useRoute();
const router = useRouter();

function checkPassword() {

  if (!password.value || !passwordConfirmation.value) {
    return t('Please enter both password and password confirmation');
  }
  if (password.value !== passwordConfirmation.value) {
    return t('Passwords do not match');
  }

  if (!passwordConstraints.value) {
    return null;
  }
  if (password.value.length < passwordConstraints.value.minLength) {
    return t(`Password must be at least {minLength} characters long`, { minLength: passwordConstraints.value.minLength });
  }

  if (password.value.length > passwordConstraints.value.maxLength) {
    return t(`Password must be at most {maxLength} characters long`, { maxLength: passwordConstraints.value.maxLength });
  }

  if (passwordConstraints.value.validation) {
    const valError = applyRegexValidation(password.value, passwordConstraints.value.validation);
    if (valError) {
      return valError;
    }
  }

  return null;
}

const validationRunning = ref(false);

const validationError = computed(() => {
  if (validationRunning.value) {
    return checkPassword();
  }
  return null;
});

const error: Ref<string | null> = ref(null);


const backgroundPosition = computed(() => {
  return coreStore.config?.loginBackgroundPosition || '1/2';
});


const passwordConstraints: Ref<{
  minLength: number;
  maxLength: number;
  validation: string;
}> = ref({
  minLength: 8,
  maxLength: 100,
  validation: '',
});

// implement something similar to beforeEnter
// beforeEnter: async (to, from, next) => {
//         if(localStorage.getItem('isAuthorized') === 'true') {
//           // check if url has next=... and redirect to it
//           console.log('to.query', to.query)
//           if (to.query.next) {
//             next(to.query.next.toString())
//           } else {
//             next({name: 'home'});
//           }
//         } else {
//           next()
//         }
//       } 

onBeforeMount(() => {
  // console.log('⛔ SignUp Page. Before Mount: ', route)
  if (localStorage.getItem('isAuthorized') === 'true') {
    // if route has next param, redirect
    coreStore.fetchMenuAndResource();
    if (route.query.next) {
      router.push(route.query.next.toString());
    } else {
      router.push({ name: 'home' });
    }
  }
})

onMounted(async () => {
  emailInput.value?.focus();
  await coreStore.fetchConfig({ redirectToLoginIfNotLoggedIn: false });

  await nextTick();
  await router.isReady();

  // getPasswordConstraints
  console.log('⛔ SignUp Page. Before Mount: ', route.meta)
  passwordConstraints.value = await callAdminForthApi({
    path: `/plugin/${route.meta.pluginInstanceId}/password-constraints`,
    method: 'GET',
  });
})

// onMounted(async () => {
// });

async function doSignup() {
  error.value = null;
  if (!email.value) {
    error.value = t('Please enter your email');
    return;
  }
  if (!requestEmailConfirmation.value && checkPassword()) {
    validationRunning.value = true;
    return;
  }

  inProgress.value = true;
  const resp = await callAdminForthApi({
    path: `/plugin/${route.meta.pluginInstanceId}/signup`,
    method: 'POST',
    body: {
      email: email.value,
      url: window.location.origin + window.location.pathname,
      ...(!requestEmailConfirmation.value ? {password: password.value} : {}),
    }
  });
  inProgress.value = false;
  if (resp.error) {
    error.value = resp.error;
  } else {
    error.value = null;
    requestSent.value = true;
    sentToEmail.value = email.value;
    if (resp.redirectTo && !requestEmailConfirmation.value) {
      router.push(resp.redirectTo);
    } else if (!requestEmailConfirmation.value) {
      error.value = null;
      await user.finishLogin();
    }
  }
}

const signupAfterEmailConfirmation = async () => {
  if (checkPassword()) {
    validationRunning.value = true;
    return;
  }
  const resp = await callAdminForthApi({
      path: `/plugin/${route.meta.pluginInstanceId}/complete-verified-signup`,
      method: 'POST',
      body: {
        token: verifyToken.value,
        password: password.value,
      }
    });
    if (resp.error) {
      adminforth.alert({
        message: t(`Error fetching data: {error}`, { error: resp.error }),
        variant: 'danger',
      });
    } else if (resp.redirectTo) {
      router.push(resp.redirectTo);
    } else {
      await user.finishLogin();
    }
}
</script>