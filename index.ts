import AdminForth, { AdminForthPlugin, Filters, suggestIfTypo, AdminForthDataTypes } from "adminforth";
import type { IAdminForth, IHttpServer, AdminForthComponentDeclaration, AdminForthResourceColumn, AdminForthResource, BeforeLoginConfirmationFunction, HttpExtra } from "adminforth";
import type { PluginOptions } from './types.js';


export default class OpenSignupPlugin extends AdminForthPlugin {
  options: PluginOptions;
  emailField: AdminForthResourceColumn;
  passwordField: AdminForthResourceColumn;
  authResource: AdminForthResource;
  emailConfirmedField?: AdminForthResourceColumn;
  
  adminforth: IAdminForth;

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);

    if (!this.options.emailField) {
      throw new Error(`emailField is required and should be a name of field in auth resource`);
    }

    // find field with name resourceConfig.emailField in adminforth.auth.usersResourceId and show error if it doesn't exist
    const authResource = adminforth.config.resources.find(r => r.resourceId === adminforth.config.auth.usersResourceId);
    if (!authResource) {
      throw new Error(`Resource with id config.auth.usersResourceId=${adminforth.config.auth.usersResourceId} not found`);
    }
    this.authResource = authResource;

    if (this.options.confirmEmails) {
      if (!this.options.confirmEmails.adapter) {
        throw new Error(`confirmEmails.adapter is required and should be a name of field in auth resource`);
      }
      if (!this.options.confirmEmails.emailConfirmedField) {
        throw new Error(`confirmEmails.emailConfirmedField is required and should be a name of field in auth resource`);
      }
      const emailConfirmedField = this.authResource.columns.find(f => f.name === this.options.confirmEmails.emailConfirmedField);
      if (!emailConfirmedField) {
        const similar = suggestIfTypo(this.authResource.columns.map(f => f.name), this.options.confirmEmails.emailConfirmedField);
        throw new Error(`Field with name ${this.options.confirmEmails.emailConfirmedField} not found in resource ${this.authResource.resourceId}.
          ${similar ? `Did you mean ${similar}?` : ''}
        `);
      }
      this.emailConfirmedField = emailConfirmedField;
    }

    const emailField = authResource.columns.find(f => f.name === this.options.emailField);
    if (!emailField) {
      const similar = suggestIfTypo(authResource.columns.map(f => f.name), this.options.emailField);

      throw new Error(`Field with name ${this.options.emailField} not found in resource ${authResource.resourceId}.
        ${similar ? `Did you mean ${similar}?` : ''}
      `);
    }
    this.emailField = emailField;

    if (!this.options.passwordField) {
      throw new Error(`passwordField is required to get password constraints and should be a name of virtual field in auth resource`);
    }

    const passwordField: AdminForthResourceColumn = authResource.columns.find(f => f.name === this.options.passwordField);
    if (!passwordField) {
      const similar = suggestIfTypo(authResource.columns.map(f => f.name), this.options.passwordField);
      throw new Error(`Field with name ${this.options.passwordField} not found in resource ${authResource.resourceId}.
        ${similar ? `Did you mean ${similar}?` : ''}
      `);
    }
    this.passwordField = passwordField;

    (adminforth.config.customization.loginPageInjections.underInputs as AdminForthComponentDeclaration[]).push({ 
      file: this.componentPath('SignupUnderLogin.vue'),
    });
    adminforth.config.customization.customPages.push({
      path: '/signup',
      component: { 
        file: this.componentPath('SignupPage.vue'), 
        meta: { 
          customLayout: true, 
          pluginInstanceId: this.pluginInstanceId,
          requestEmailConfirmation: !!this.options.confirmEmails
        }
      }
    });

    // for confirmation disable login if email is not confirmed
    if (this.options.confirmEmails) {
      if (!adminforth.config.auth.beforeLoginConfirmation) {
        adminforth.config.auth.beforeLoginConfirmation = [];
      }
    }
  }
  
  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    if (this.options.confirmEmails) {
      this.options.confirmEmails.adapter.validate();
    }


    if(this.options.confirmEmails){
      const emailConfirmedColumn = this.resourceConfig.columns.find(f => f.name === this.options.confirmEmails.emailConfirmedField);
      if (emailConfirmedColumn.type !== AdminForthDataTypes.BOOLEAN) {
        throw new Error(`Field ${this.emailConfirmedField.name} must be of type boolean`);
      }
    }
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    // optional method to return unique string representation of plugin instance. 
    // Needed if plugin can have multiple instances on one resource 
    return `single`;
  }

  async doLogin(email: string, response: any, extra: HttpExtra): Promise<{ error?: string; allowedLogin: boolean; redirectTo?: string; }> {

    const username = email;
    const userRecord = await this.adminforth.resource(this.authResource.resourceId).get(Filters.EQ(this.emailField.name, email));
    const adminUser = { 
      dbUser: userRecord,
      pk: userRecord[this.authResource.columns.find((col) => col.primaryKey).name], 
      username,
    };
    const toReturn = { allowedLogin: true, error: '' };

    await this.adminforth.restApi.processLoginCallbacks(adminUser, toReturn, response, extra);
    if (toReturn.allowedLogin) {
      this.adminforth.auth.setAuthCookie({ 
        response, 
        username, 
        pk: userRecord[
          this.authResource.columns.find((col) => col.primaryKey).name
        ] 
      });
    }

    return toReturn;
  }


  setupEndpoints(server: IHttpServer) {

    server.endpoint({
      method: 'GET',
      path: `/plugin/${this.pluginInstanceId}/password-constraints`,
      noAuth: true,
      handler: async ({tr}) => {
        return {
          minLength: this.passwordField.minLength,
          maxLength: this.passwordField.maxLength,
          validation: await Promise.all(
            this.passwordField.validation.map(async ({ regExp, message }) => ({ regExp, message: await tr(message, 'opensignup') }))
          ),
        };
      }
    });
    
    server.endpoint({
      method: 'POST',
      path: `/plugin/${this.pluginInstanceId}/complete-verified-signup`,
      noAuth: true,
      handler: async ({ body, response, headers, query, cookies, tr, requestUrl }) => {
        const { token, password } = body;
        const { email } = await this.adminforth.auth.verify(token, 'tempVerifyEmailToken', false);
        if (!email) {
          return { error: await tr('Invalid token', 'opensignup'), ok: false };
        }

        if(!password) {
          return { error: await tr('Password is required', 'opensignup'), ok: false };
        }
        const userRecord = await this.adminforth.resource(this.authResource.resourceId).get(Filters.EQ(this.emailField.name, email));
        if (!userRecord) {
          return { error: await tr('User not found', 'opensignup'), ok: false };
        }

        if (userRecord[this.options.confirmEmails.emailConfirmedField]) {
          return { error: await tr('Email already confirmed', 'opensignup'), ok: false };
        }

        await this.adminforth.resource(this.authResource.resourceId).update(userRecord[this.authResource.columns.find((col) => col.primaryKey).name], {
          [this.options.confirmEmails.emailConfirmedField]: true,
          [this.options.passwordHashField]: await AdminForth.Utils.generatePasswordHash(password),
        });
        return await this.doLogin(email, response, { body, headers, query, cookies, requestUrl });
      }
    });

    server.endpoint({
      method: 'POST',
      path: `/plugin/${this.pluginInstanceId}/signup`,
      noAuth: true,
      handler: async ({ body, response, headers, query, cookies, tr, requestUrl }) => {
        const { email, url, password } = body;
        const extra = { body, headers, query, cookies, requestUrl: url };
        // validate email
        if (this.emailField.validation) {
          for (const { regExp, message } of this.emailField.validation) {
            if (!new RegExp(regExp).test(email)) {
              return { error: await tr(message, 'opensignup'), ok: false };
            }
          }
        }
        // validate password
        if (!this.options.confirmEmails) {
          if (password.length < this.passwordField.minLength) {
            return { 
              error: await tr(`Password must be at least ${this.passwordField.minLength} characters long`, 'opensignup'),
              ok: false 
            };
          }
          if (password.length > this.passwordField.maxLength) {
            return { 
              error: await tr(`Password must be at most ${this.passwordField.maxLength} characters long`, 'opensignup'),
              ok: false 
            };
          }
          if (this.passwordField.validation) {
            for (const { regExp, message } of this.passwordField.validation) {
              if (!new RegExp(regExp).test(password)) {
                return { error: await tr(message, 'opensignup'), ok: false };
              }
            }
          }
        }
        
        // This is not needed when right email validator is set on email field because
        // it will not allow to create such email, but if user forgot to set it it might save situation 
        const normalizedEmail = email.toLowerCase();  // normalize email

        // first check again if email already exists
        const existingUser = await this.adminforth.resource(this.authResource.resourceId).get(Filters.EQ(this.emailField.name, normalizedEmail));
        if ((!this.options.confirmEmails && existingUser) || (this.options.confirmEmails && existingUser?.[this.emailConfirmedField.name])) {
          return { error: await tr(`Email already exists`, 'opensignup'), ok: false };
        }

        // create user
        if (!existingUser) {
          let recordToCreate = {
            ...(this.options.defaultFieldValues || {}),
            ...(this.options.confirmEmails ? { [this.options.confirmEmails.emailConfirmedField]: false } : {}),  
            [this.emailField.name]: normalizedEmail,
            [this.options.passwordHashField]: password ? await AdminForth.Utils.generatePasswordHash(password) : '',
          };

          if (this.options.hooks?.beforeUserSave) {
            const hook = this.options.hooks.beforeUserSave;
            const resp = await hook({ 
              resource: this.authResource,
              record: recordToCreate,
              adminforth: this.adminforth,
              extra,
            });

            if (!resp || (!resp.ok && !resp.error)) {
              throw new Error(`Hook beforeUserSave must return object with {ok: true} or { error: 'Error' } `);
            }
            if (resp.error) {
              return { error: resp.error };
            }
            recordToCreate = resp.record || recordToCreate;
          }

          const created = await this.adminforth.resource(this.authResource.resourceId).create(recordToCreate);

          if (this.options.hooks?.afterUserSave) {
            const hook = this.options.hooks.afterUserSave;
            const resp = await hook({ 
              resource: this.authResource,
              record: created,
              adminforth: this.adminforth,
              extra,
            });

            if (!resp || (!resp.ok && !resp.error)) {
              throw new Error(`Hook afterUserSave must return object with {ok: true} or { error: 'Error' } `);
            }
            if (resp.error) {
              return { error: resp.error };
            }
          }
        }
        
        if (!this.options.confirmEmails) {
          const resp = await this.doLogin(email, response, { body, headers, query, cookies, requestUrl });
          return resp;
        }

        // send confirmation email

        const brandName = this.adminforth.config.customization.brandName;

        const verifyToken = this.adminforth.auth.issueJWT({email, issuer: brandName }, 'tempVerifyEmailToken', '2h');
        process.env.HEAVY_DEBUG && console.log('🐛Sending reset tok to', verifyToken);
        const emailText = await tr(`
                  Dear user,
                  Welcome to {brandName}! 
                  
                  To confirm your email, click the link below:\n\n

                  {url}?verifyToken={verifyToken}\n\n

                  If you didn't request this, please ignore this email.\n\n
                  Link is valid for 2 hours.\n\n

                  Thanks,
                  The {brandName} Team
                                    
                `, 'opensignup', { brandName, url, verifyToken }
        );

        const emailData = {
          greeting: await tr('Dear user,', 'opensignup'),
          welcome: await tr('Welcome to {brandName}!', 'opensignup', { brandName }),
          instruction: await tr('To confirm your email, click the link below:', 'opensignup'),
          linkText: await tr('Confirm email', 'opensignup'),
          disclaimer: await tr('If you didn\'t request this, please ignore this email.', 'opensignup'),
          validity: await tr('Link is valid for 2 hours.', 'opensignup'),
          thanks: await tr('Thanks,', 'opensignup'),
          team: await tr('The {brandName} Team', 'opensignup', { brandName }),
        };
          
        const emailHtml = `
          <html>
            <head></head>
            <body>
              <p>${emailData.greeting}</p>
              <p>${emailData.welcome}</p>
              <p>${emailData.instruction}</p>
              <a href="${url}?token=${verifyToken}">${emailData.linkText}</a>
              <p>${emailData.disclaimer}</p>
              <p>${emailData.validity}</p>
              <p>${emailData.thanks}</p>
              <p>${emailData.team}</p>
            </body>
          </html>
        `;
        const emailSubject = await tr(`Signup request at {brandName}`, 'opensignup', { brandName });

        // send email with AWS SES this.options.providerOptions.AWS_SES
        this.options.confirmEmails.adapter.sendEmail(this.options.confirmEmails.sendFrom, email, emailText, emailHtml, emailSubject);

        return { ok: true };
      }
    });

   

  }

}