import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { FretboardComponent } from './components/fretboard/fretboard.component';
import { CommonModule } from '@angular/common';

@NgModule({
  declarations: [
    // No components declared here since they're all standalone
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    CommonModule,
    FretboardComponent,
    AppComponent
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }