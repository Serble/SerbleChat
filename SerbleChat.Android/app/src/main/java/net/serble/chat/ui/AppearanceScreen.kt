package net.serble.chat.ui

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.serble.chat.data.AppTheme
import net.serble.chat.data.HEX_COLOR
import net.serble.chat.data.THEME_PROPS
import net.serble.chat.data.ThemeColors
import net.serble.chat.ui.theme.hex

/** The themes, the same ones as on the web: pick one, or make and edit your own. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppearanceScreen(onBack: () -> Unit, onEdit: (String) -> Unit) {
    val app = LocalApp.current
    val themes = app.themes
    val all by themes.all.collectAsStateWithLifecycle()
    val active by themes.active.collectAsStateWithLifecycle()
    val messages = LocalMessages.current
    val context = LocalContext.current
    var importing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<AppTheme?>(null) }

    Scaffold(modifier = Modifier.swipeBack(), topBar = {
        TopAppBar(
            title = { Text("Appearance") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = { IconButton(onClick = { importing = true }) { Icon(Icons.Default.FileUpload, "Import a theme") } },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize().navigationBarsPadding()) {
            item {
                Text("Themes are kept with your account, so they're the same here and on the web.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                ThemePreview(active.colors, Modifier.padding(16.dp))
                SectionLabel("Built in")
            }
            items(all.filter { it.builtIn }, key = { it.id }) { theme ->
                ThemeRow(theme, active = theme.id == active.id, onUse = { themes.activate(theme.id) }, onEdit = {
                    // Built-in themes can't change; editing one starts a copy, as on the web
                    val id = themes.create("${theme.name} (custom)", theme.colors)
                    themes.activate(id)
                    onEdit(id)
                }, onDelete = null)
            }
            item { SectionLabel("Yours") }
            val custom = all.filter { !it.builtIn }
            if (custom.isEmpty()) item {
                Text("None yet. Make one from scratch, or tap the pencil on a built-in theme to start from it.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            items(custom, key = { it.id }) { theme ->
                ThemeRow(theme, active = theme.id == active.id, onUse = { themes.activate(theme.id) },
                    onEdit = { onEdit(theme.id) }, onDelete = { deleting = theme })
            }
            item {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        val id = themes.create("My Theme", active.colors)
                        themes.activate(id)
                        onEdit(id)
                    }) {
                        Icon(Icons.Default.Add, null)
                        Spacer(Modifier.width(6.dp))
                        Text("New theme")
                    }
                    OutlinedButton(onClick = {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "application/json"
                            putExtra(Intent.EXTRA_TEXT, themes.export(active))
                            putExtra(Intent.EXTRA_SUBJECT, "${active.name}.json")
                        }, "Share theme"))
                    }) {
                        Icon(Icons.Default.Share, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Share current")
                    }
                }
            }
        }
    }

    if (importing) ImportThemeDialog(onDismiss = { importing = false }, onImported = { id ->
        importing = false
        themes.activate(id)
        messages.show("Theme imported")
    })
    deleting?.let { theme ->
        ConfirmDialog("Delete ${theme.name}?", "It'll be gone from the web app too.", "Delete", destructive = true,
            onDismiss = { deleting = null }) {
            deleting = null
            themes.delete(theme.id)
        }
    }
}

@Composable
private fun ThemeRow(theme: AppTheme, active: Boolean, onUse: () -> Unit, onEdit: () -> Unit, onDelete: (() -> Unit)?) {
    ListRow(selected = active, onClick = onUse) {
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            listOf(theme.colors.bgBase, theme.colors.bgSecondary, theme.colors.accent).forEach {
                Box(Modifier.size(width = 12.dp, height = 24.dp).clip(RoundedCornerShape(3.dp)).background(hex(it))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(3.dp)))
            }
        }
        RowSpacer()
        Text(theme.name, style = MaterialTheme.typography.bodyLarge, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (active) Icon(Icons.Default.Check, "In use", tint = MaterialTheme.colorScheme.primary)
        IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, if (theme.builtIn) "Customise" else "Edit") }
        if (onDelete != null) IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Delete") }
    }
}

/** A small mock of the app in a theme's colours. */
@Composable
fun ThemePreview(c: ThemeColors, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, hex(c.border), RoundedCornerShape(12.dp))) {
        Column(Modifier.width(36.dp).fillMaxSize().background(hex(c.bgTertiary)).padding(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(24.dp).clip(RoundedCornerShape(8.dp)).background(hex(c.accent)))
            Box(Modifier.size(24.dp).clip(CircleShape).background(hex(c.bgActive)))
        }
        Column(Modifier.width(84.dp).fillMaxSize().background(hex(c.bgSecondary)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("# general", color = hex(c.textPrimary), style = MaterialTheme.typography.labelSmall, maxLines = 1,
                modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(hex(c.bgActive)).padding(horizontal = 4.dp))
            Text("# random", color = hex(c.textMuted), style = MaterialTheme.typography.labelSmall, maxLines = 1)
        }
        Column(Modifier.weight(1f).fillMaxSize().background(hex(c.bgBase)).padding(8.dp)) {
            Text("Someone", color = hex(c.textPrimary), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
            Text("Hello! @you", color = hex(c.textSecondary), style = MaterialTheme.typography.bodySmall)
            Text("a link", color = hex(c.textLink), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.weight(1f))
            Box(Modifier.fillMaxWidth().height(22.dp).clip(RoundedCornerShape(11.dp)).background(hex(c.bgInput)))
        }
    }
}

/** Edits a custom theme. Changes apply as they're made, and save to the account shortly after. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThemeEditorScreen(id: String, onBack: () -> Unit) {
    val app = LocalApp.current
    val themes = app.themes
    val all by themes.all.collectAsStateWithLifecycle()
    val theme = all.firstOrNull { it.id == id }
    val context = LocalContext.current
    var picking by remember { mutableStateOf<String?>(null) }
    var name by remember(id) { mutableStateOf(theme?.name ?: "") }
    if (theme == null) {
        androidx.compose.runtime.LaunchedEffect(Unit) { onBack() }
        return
    }

    Scaffold(modifier = Modifier.swipeBack(), topBar = {
        TopAppBar(
            title = { Text("Edit theme") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = {
                IconButton(onClick = {
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_TEXT, themes.export(theme))
                        putExtra(Intent.EXTRA_SUBJECT, "${theme.name}.json")
                    }, "Export theme"))
                }) { Icon(Icons.Default.FileDownload, "Export") }
            },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize().navigationBarsPadding()) {
            item {
                OutlinedTextField(name, {
                    name = it
                    if (it.isNotBlank()) themes.update(id, name = it.trim())
                }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(16.dp))
                ThemePreview(theme.colors, Modifier.padding(horizontal = 16.dp))
            }
            THEME_PROPS.groupBy { it.group }.forEach { (group, props) ->
                item { SectionLabel(group) }
                items(props, key = { it.key }) { prop ->
                    ColorRow(prop.label, theme.colors[prop.key], onPick = { picking = prop.key }) { value ->
                        themes.update(id, colors = theme.colors.with(prop.key, value))
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    picking?.let { key ->
        ColorPickerDialog(
            title = THEME_PROPS.first { it.key == key }.label,
            initial = theme.colors[key],
            onDismiss = { picking = null },
            onPick = { value ->
                picking = null
                themes.update(id, colors = theme.colors.with(key, value))
            },
        )
    }
}

@Composable
private fun ColorRow(label: String, value: String, onPick: () -> Unit, onChange: (String) -> Unit) {
    var text by remember(value) { mutableStateOf(value) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(hex(value))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)).clickable(onClick = onPick))
        Spacer(Modifier.width(12.dp))
        OutlinedTextField(
            text,
            {
                text = it.trim().take(7)
                if (HEX_COLOR.matches(text)) onChange(text.lowercase())
            },
            singleLine = true,
            isError = !HEX_COLOR.matches(text),
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.width(118.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
    }
}

/** Hue, saturation and value, with a hex field: enough to land on any colour. */
@Composable
fun ColorPickerDialog(title: String, initial: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val start = remember { FloatArray(3).also { android.graphics.Color.colorToHSV(hex(initial).toArgb(), it) } }
    var hue by remember { mutableFloatStateOf(start[0]) }
    var sat by remember { mutableFloatStateOf(start[1]) }
    var value by remember { mutableFloatStateOf(start[2]) }
    val color = Color.hsv(hue, sat, value)
    val hexText = String.format("#%06x", color.toArgb() and 0xFFFFFF)
    var typed by remember { mutableStateOf(hexText) }
    var typing by remember { mutableStateOf(false) }

    fun setFromHex(h: String) {
        val hsv = FloatArray(3)
        android.graphics.Color.colorToHSV(hex(h).toArgb(), hsv)
        hue = hsv[0]; sat = hsv[1]; value = hsv[2]
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                // Saturation left to right, value top to bottom, for the current hue
                Box(
                    Modifier.fillMaxWidth().aspectRatio(1.4f).clip(RoundedCornerShape(10.dp))
                        .pointerInput(Unit) {
                            fun at(o: Offset) {
                                sat = (o.x / size.width).coerceIn(0f, 1f)
                                value = 1f - (o.y / size.height).coerceIn(0f, 1f)
                                typing = false
                            }
                            detectTapGestures { at(it) }
                        }
                        .pointerInput(Unit) {
                            detectDragGestures { change, _ ->
                                sat = (change.position.x / size.width).coerceIn(0f, 1f)
                                value = 1f - (change.position.y / size.height).coerceIn(0f, 1f)
                                typing = false
                            }
                        },
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                        drawRect(Brush.horizontalGradient(listOf(Color.White, Color.hsv(hue, 1f, 1f))))
                        drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
                        val p = Offset(sat * size.width, (1f - value) * size.height)
                        drawCircle(Color.White, 9.dp.toPx(), p, style = Stroke(3.dp.toPx()))
                        drawCircle(Color.Black.copy(alpha = 0.4f), 10.5.dp.toPx(), p, style = Stroke(1.dp.toPx()))
                    }
                }
                Spacer(Modifier.height(14.dp))
                Box(
                    Modifier.fillMaxWidth().height(28.dp).clip(RoundedCornerShape(14.dp))
                        .pointerInput(Unit) {
                            detectTapGestures { hue = (it.x / size.width).coerceIn(0f, 1f) * 360f; typing = false }
                        }
                        .pointerInput(Unit) {
                            detectDragGestures { change, _ -> hue = (change.position.x / size.width).coerceIn(0f, 1f) * 360f; typing = false }
                        },
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                        drawRect(Brush.horizontalGradient((0..6).map { Color.hsv(it * 60f % 360f, 1f, 1f) }))
                        val x = hue / 360f * size.width
                        drawCircle(Color.White, size.height / 2 - 2.dp.toPx(), Offset(x, size.height / 2), style = Stroke(3.dp.toPx()))
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(8.dp), color = color, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier.size(44.dp)) {}
                    Spacer(Modifier.width(12.dp))
                    OutlinedTextField(
                        if (typing) typed else hexText,
                        {
                            typing = true
                            typed = it.trim().take(7)
                            if (HEX_COLOR.matches(typed)) setFromHex(typed)
                        },
                        singleLine = true,
                        label = { Text("Hex") },
                        textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = { onPick(hexText) }) { Text("Use") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Paste a theme's JSON, or open a .json file exported from either app. */
@Composable
private fun ImportThemeDialog(onDismiss: () -> Unit, onImported: (String) -> Unit) {
    val app = LocalApp.current
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    fun tryImport(json: String, fallbackName: String) {
        try {
            onImported(app.themes.import(json, fallbackName))
        } catch (e: Exception) {
            error = "Import failed: ${e.message}"
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val content = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().decodeToString() } }.getOrNull()
        if (content == null) error = "Couldn't read that file."
        else tryImport(content, uri.lastPathSegment?.substringAfterLast('/')?.removeSuffix(".json") ?: "Imported theme")
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Import a theme") },
        text = {
            Column {
                Text("Paste a theme exported from Serble Chat, or open its file.", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(text, { text = it; error = null }, label = { Text("Theme JSON") }, minLines = 4, maxLines = 8,
                    modifier = Modifier.fillMaxWidth(), textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
                TextButton(onClick = { picker.launch(arrayOf("application/json", "text/plain", "*/*")) }) { Text("Open a file…") }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { tryImport(text, "Imported theme") }) { Text("Import") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
