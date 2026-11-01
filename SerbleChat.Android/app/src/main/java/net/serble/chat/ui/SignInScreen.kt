package net.serble.chat.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.serble.chat.R

@Composable
fun SignInScreen(busy: Boolean, onSignIn: () -> Unit, onDevSignIn: ((String) -> Unit)?) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().systemBarsPadding().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Image(
                painterResource(R.drawable.logo),
                contentDescription = null,
                modifier = Modifier.size(112.dp).clip(RoundedCornerShape(26.dp)),
            )
            Spacer(Modifier.height(28.dp))
            Text("Serble Chat", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                "Talk with your friends, groups and guilds.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(36.dp))
            Button(onClick = onSignIn, enabled = !busy, modifier = Modifier.fillMaxWidth().widthIn(max = 360.dp).height(52.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else Text("Sign in with Serble")
            }
            if (onDevSignIn != null) DevSignIn(onDevSignIn)
        }
    }
}

/** Debug builds only: sign in as a fresh test account, for backends that allow generating them. */
@Composable
private fun DevSignIn(onToken: (String) -> Unit) {
    val app = LocalApp.current
    val messages = LocalMessages.current
    val scope = rememberCoroutineScope()
    var token by remember { mutableStateOf("") }
    Spacer(Modifier.height(24.dp))
    OutlinedTextField(token, { token = it }, label = { Text("Developer token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(8.dp))
    TextButton(onClick = {
        if (token.isNotBlank()) onToken(token.trim()) else scope.launch {
            try {
                val tokens = app.api.get<List<String>>("/auth/tokens/1")
                onToken(tokens.first())
            } catch (e: Exception) {
                messages.show("Test accounts aren't enabled on this server: ${e.message}")
            }
        }
    }) { Text(if (token.isBlank()) "Use a new test account" else "Use this token") }
}
