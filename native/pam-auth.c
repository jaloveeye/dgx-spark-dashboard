#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct pam_handle pam_handle_t;

struct pam_message {
  int msg_style;
  const char *msg;
};

struct pam_response {
  char *resp;
  int resp_retcode;
};

struct pam_conv {
  int (*conv)(int, const struct pam_message **, struct pam_response **, void *);
  void *appdata_ptr;
};

extern int pam_start(const char *, const char *, const struct pam_conv *, pam_handle_t **);
extern int pam_end(pam_handle_t *, int);
extern int pam_authenticate(pam_handle_t *, int);
extern int pam_acct_mgmt(pam_handle_t *, int);
extern int pam_set_item(pam_handle_t *, int, const void *);

enum {
  PAM_SUCCESS = 0,
  PAM_CONV_ERR = 19,
  PAM_PROMPT_ECHO_OFF = 1,
  PAM_PROMPT_ECHO_ON = 2,
  PAM_ERROR_MSG = 3,
  PAM_TEXT_INFO = 4,
  PAM_RHOST = 4,
  PAM_SILENT = 0x8000,
  PAM_DISALLOW_NULL_AUTHTOK = 0x0001,
};

struct credentials {
  const char *username;
  const char *password;
};

static void clear_secret(void *pointer, size_t length) {
  volatile unsigned char *bytes = pointer;
  while (length-- > 0) *bytes++ = 0;
}

static void free_responses(struct pam_response *responses, int count) {
  if (responses == NULL) return;
  for (int index = 0; index < count; index++) {
    if (responses[index].resp != NULL) {
      clear_secret(responses[index].resp, strlen(responses[index].resp));
      free(responses[index].resp);
    }
  }
  free(responses);
}

static int conversation(int count, const struct pam_message **messages, struct pam_response **output, void *data) {
  if (count <= 0 || messages == NULL || output == NULL || data == NULL) return PAM_CONV_ERR;
  const struct credentials *credentials = data;
  struct pam_response *responses = calloc((size_t)count, sizeof(*responses));
  if (responses == NULL) return PAM_CONV_ERR;

  for (int index = 0; index < count; index++) {
    if (messages[index] == NULL) {
      free_responses(responses, count);
      return PAM_CONV_ERR;
    }
    switch (messages[index]->msg_style) {
      case PAM_PROMPT_ECHO_OFF:
        responses[index].resp = strdup(credentials->password);
        break;
      case PAM_PROMPT_ECHO_ON:
        responses[index].resp = strdup(credentials->username);
        break;
      case PAM_ERROR_MSG:
      case PAM_TEXT_INFO:
        responses[index].resp = strdup("");
        break;
      default:
        free_responses(responses, count);
        return PAM_CONV_ERR;
    }
    if (responses[index].resp == NULL) {
      free_responses(responses, count);
      return PAM_CONV_ERR;
    }
  }

  *output = responses;
  return PAM_SUCCESS;
}

static int read_password(char *password, size_t capacity) {
  size_t used = 0;
  while (used < capacity - 1) {
    ssize_t count = read(STDIN_FILENO, password + used, capacity - 1 - used);
    if (count == 0) break;
    if (count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    used += (size_t)count;
  }

  if (used == 0 || used == capacity - 1) return -1;
  if (memchr(password, '\0', used) != NULL) return -1;
  password[used] = '\0';
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 3 || argv[1][0] == '\0' || strlen(argv[1]) > 64 || strlen(argv[2]) > 255) return 2;

  char password[4097] = {0};
  if (read_password(password, sizeof(password)) != 0) {
    clear_secret(password, sizeof(password));
    return 2;
  }

  const char *service = getenv("PAM_SERVICE");
  if (service == NULL || service[0] == '\0') service = "login";

  struct credentials credentials = { argv[1], password };
  struct pam_conv conv = { conversation, &credentials };
  pam_handle_t *handle = NULL;
  int result = pam_start(service, argv[1], &conv, &handle);

  if (result == PAM_SUCCESS && argv[2][0] != '\0') result = pam_set_item(handle, PAM_RHOST, argv[2]);
  if (result == PAM_SUCCESS) result = pam_authenticate(handle, PAM_SILENT | PAM_DISALLOW_NULL_AUTHTOK);
  if (result == PAM_SUCCESS) result = pam_acct_mgmt(handle, PAM_SILENT);

  if (handle != NULL) pam_end(handle, result);
  clear_secret(password, sizeof(password));
  return result == PAM_SUCCESS ? 0 : 1;
}
